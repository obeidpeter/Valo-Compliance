import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

type RequestScope = { signal: AbortSignal; isCurrent: () => boolean; onUnauthorized?: () => void };
type Operation = { expectedVersion: number; body: string; idempotencyKey: string };
type Attempt = { signature: string; input: Operation };
type Message = {
  id: string;
  body: string;
  createdAt: string;
  authorKind: "customer" | "staff";
  visibility: "customer" | "internal";
};
type Subject = {
  supportAttempt: (previous: Attempt | null, input: Omit<Operation, "idempotencyKey">) => Attempt;
  uncertainSupportResult: (error: unknown) => boolean;
  listSupportCases: (staff: boolean, page: number, status?: string, signal?: AbortSignal) => Promise<unknown>;
  getSupportCase: (staff: boolean, id: string, page?: number, signal?: AbortSignal) => Promise<unknown>;
  replyToSupportCase: (id: string, input: Operation) => Promise<unknown>;
  actOnSupportCase: (id: string, input: Operation & { action: string }) => Promise<unknown>;
  listContentEscalations: (page: number, signal?: AbortSignal) => Promise<unknown>;
  actOnContentEscalation: (id: string, input: Operation & { action: string }) => Promise<unknown>;
  installRequestScopeProvider: (provider: () => RequestScope) => () => void;
  renderMessages: (messages: Message[], staff?: boolean) => string;
};

test("support UI transport and conversation boundaries", async (t) => {
  const base = fileURLToPath(new URL("../../../../", import.meta.url));
  const source = join(base, "artifacts/valo/src");
  const dir = await mkdtemp(join(tmpdir(), "valo-support-ui-"));
  const entry = join(dir, "subject.cjs");
  const originalFetch = globalThis.fetch;
  const bundle = await build({
    stdin: {
      contents: `
    export * from ${JSON.stringify(join(source, "lib/support-case-api.ts"))};
    export {installRequestScopeProvider} from ${JSON.stringify(join(base, "lib/api-client-react/src/request-scope.ts"))};
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {SupportMessages} from ${JSON.stringify(join(source, "components/support-cases.tsx"))};
    export const renderMessages=(messages,staff=false)=>renderToStaticMarkup(React.createElement(SupportMessages,{messages,staff}));
  `,
      resolveDir: join(base, "artifacts/valo"),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    nodePaths: [join(base, "artifacts/valo/node_modules"), join(base, "node_modules")],
    plugins: [
      {
        name: "support-test-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/api-client-react$/ }, () => ({
            path: join(base, "lib/api-client-react/src/index.ts"),
          }));
          // The rendered conversation has no authentication or query hooks. The
          // real protected transport below is tested separately, including a late
          // response after the account scope ends.
          builder.onResolve({ filter: /account-state-boundary$/ }, () => ({
            path: "epoch",
            namespace: "support-test",
          }));
          builder.onResolve({ filter: /^\.\/states$/ }, () => ({
            path: "states",
            namespace: "support-test",
          }));
          builder.onResolve({ filter: /^@\/lib\/api$/ }, () => ({ path: "date", namespace: "support-test" }));
          builder.onResolve({ filter: /^@\// }, (args) => ({
            path: join(source, `${args.path.slice(2)}.ts`),
          }));
          builder.onLoad({ filter: /.*/, namespace: "support-test" }, (args) => ({
            loader: "ts",
            contents:
              args.path === "epoch"
                ? "export const useAccountEpoch=()=>()=>true;"
                : args.path === "states"
                  ? "export const ErrorState=()=>null;"
                  : "export const formatDate=(value:string)=>value;",
          }));
        },
      },
    ],
  });
  await writeFile(entry, bundle.outputFiles![0]!.contents);
  const subject = createRequire(entry)(entry) as Subject;
  try {
    await t.test(
      "an uncertain save retries the identical idempotent input; a reviewed version creates a new operation",
      () => {
        const first = subject.supportAttempt(null, { expectedVersion: 3, body: "Scoped support reply." });
        const retry = subject.supportAttempt(first, { expectedVersion: 3, body: "Scoped support reply." });
        const reviewed = subject.supportAttempt(first, { expectedVersion: 4, body: "Scoped support reply." });
        assert.equal(retry, first);
        assert.match(first.input.idempotencyKey, /^[0-9a-f-]{36}$/);
        assert.notEqual(reviewed.input.idempotencyKey, first.input.idempotencyKey);
        assert.equal(subject.uncertainSupportResult({ status: 503 }), true);
        assert.equal(subject.uncertainSupportResult({ status: 200, name: "ResponseParseError" }), true);
        assert.equal(subject.uncertainSupportResult(new TypeError("fetch failed")), true);
        assert.equal(subject.uncertainSupportResult({ status: 409 }), false);
        assert.equal(subject.uncertainSupportResult({ status: 403 }), false);
      },
    );
    await t.test(
      "a committed 200 response with malformed JSON remains an uncertain idempotent operation",
      async () => {
        globalThis.fetch = async () =>
          new Response('{"case":', { status: 200, headers: { "content-type": "application/json" } });
        const first = subject.supportAttempt(null, {
          expectedVersion: 2,
          body: "Save with a truncated success response.",
        });
        let caught: unknown;
        try {
          await subject.replyToSupportCase("case-with-truncated-response", first.input);
        } catch (error) {
          caught = error;
        }
        assert.ok(caught);
        assert.equal(subject.uncertainSupportResult(caught), true);
        assert.equal(subject.supportAttempt(first, { expectedVersion: 2, body: first.input.body }), first);
      },
    );
    await t.test(
      "HTML and mismatched content-triage success bodies cannot confirm a hold or clear its original request",
      async () => {
        const first = subject.supportAttempt(null, {
          expectedVersion: 2,
          body: "Hold this exact referred version for review.",
        });
        for (const response of [
          new Response("<html>Temporary gateway page</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
          Response.json({ escalation: { id: "different-referral", status: "acknowledged" }, caseVersion: 3 }),
          Response.json({
            escalation: { id: "referral-id", status: "acknowledged" },
            caseVersion: "unverified",
          }),
          Response.json({
            escalation: { id: "referral-id", status: "acknowledged", sourceImpactId: null },
            caseVersion: 3,
          }),
          Response.json({
            escalation: { id: "referral-id", status: "acknowledged", sourceImpactId: "missing-lineage" },
            caseVersion: 3,
          }),
          Response.json({
            escalation: {
              id: "referral-id",
              status: "acknowledged",
              sourceImpactId: "55555555-5555-4555-8555-555555555555",
            },
            caseVersion: 2,
          }),
        ]) {
          globalThis.fetch = async () => response;
          await assert.rejects(
            subject.actOnContentEscalation("referral-id", { ...first.input, action: "hold_and_reassess" }),
            (error) => subject.uncertainSupportResult(error),
          );
          assert.equal(subject.supportAttempt(first, { expectedVersion: 2, body: first.input.body }), first);
        }
        globalThis.fetch = async () =>
          Response.json({ case: { id: "case-id", status: "open", version: 2 }, messages: [] });
        await assert.rejects(subject.replyToSupportCase("case-id", first.input), (error) =>
          subject.uncertainSupportResult(error),
        );
      },
    );
    await t.test(
      "customer rendering excludes internal messages even if a malformed response includes one",
      () => {
        const messages: Message[] = [
          {
            id: "public",
            body: "Customer-visible saved reply.",
            createdAt: "2026-11-15T00:00:00Z",
            authorKind: "staff",
            visibility: "customer",
          },
          {
            id: "private",
            body: "INTERNAL_CASE_NOTE",
            createdAt: "2026-11-15T00:00:00Z",
            authorKind: "staff",
            visibility: "internal",
          },
        ];
        const customer = subject.renderMessages(messages);
        const staff = subject.renderMessages(messages, true);
        assert.match(customer, /Customer-visible saved reply/);
        assert.doesNotMatch(customer, /INTERNAL_CASE_NOTE/);
        assert.match(staff, /INTERNAL_CASE_NOTE/);
        assert.match(staff, /Internal record · not sent/);
      },
    );
    await t.test(
      "case and message pages use protected endpoint paths and keep mutation version/key intact",
      async () => {
        const calls: {
          url: string;
          method: string;
          body: unknown;
          signal: AbortSignal | null | undefined;
        }[] = [];
        globalThis.fetch = async (input, options) => {
          calls.push({
            url: String(input),
            method: options?.method ?? "GET",
            body: options?.body ? JSON.parse(String(options.body)) : null,
            signal: options?.signal,
          });
          const mutationId = String(input).match(/\/support-cases\/([^/]+)\/(?:reply|action)$/)?.[1];
          if (mutationId)
            return Response.json({
              case: { id: decodeURIComponent(mutationId), status: "open", version: 8 },
              messages: [],
            });
          if (String(input).endsWith("/support-escalations/referral-id/action"))
            return Response.json({
              escalation: {
                id: "referral-id",
                status: "acknowledged",
                sourceImpactId: "55555555-5555-4555-8555-555555555555",
              },
              caseVersion: 8,
            });
          return Response.json({ ok: true });
        };
        const controller = new AbortController();
        const uninstall = subject.installRequestScopeProvider(() => ({
          isCurrent: () => true,
          signal: controller.signal,
        }));
        try {
          await subject.listSupportCases(false, 2);
          await subject.listSupportCases(true, 3, "awaiting_customer");
          await subject.getSupportCase(false, "case/id", 4);
          const input = subject.supportAttempt(null, {
            expectedVersion: 7,
            body: "Saved scoped message.",
          }).input;
          await subject.replyToSupportCase("customer-id", input);
          await subject.actOnSupportCase("staff-id", { ...input, action: "resolve" });
          await subject.listContentEscalations(2);
          await subject.actOnContentEscalation("referral-id", { ...input, action: "hold_and_reassess" });
          assert.deepEqual(
            calls.map((call) => [call.url, call.method]),
            [
              ["/api/workspace/support-cases?page=2", "GET"],
              ["/api/admin/support-cases?page=3&status=awaiting_customer", "GET"],
              ["/api/workspace/support-cases/case%2Fid?messagesPage=4", "GET"],
              ["/api/workspace/support-cases/customer-id/reply", "POST"],
              ["/api/admin/support-cases/staff-id/action", "POST"],
              ["/api/admin/support-escalations?page=2", "GET"],
              ["/api/admin/support-escalations/referral-id/action", "POST"],
            ],
          );
          assert.deepEqual(calls[3]!.body, input);
          assert.deepEqual(calls[4]!.body, { ...input, action: "resolve" });
          assert.deepEqual(calls[6]!.body, { ...input, action: "hold_and_reassess" });
          assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
        } finally {
          uninstall();
        }
      },
    );
    await t.test(
      "late support mutation responses cannot return data after the original account ends",
      async () => {
        let active = true;
        const controller = new AbortController();
        const uninstall = subject.installRequestScopeProvider(() => ({
          isCurrent: () => active,
          signal: controller.signal,
        }));
        let release!: (response: Response) => void;
        globalThis.fetch = async () =>
          new Promise((resolve) => {
            release = resolve;
          });
        try {
          const input = subject.supportAttempt(null, {
            expectedVersion: 1,
            body: "Private original account reply.",
          }).input;
          const pending = subject.replyToSupportCase("original-account-case", input);
          active = false;
          controller.abort();
          release(Response.json({ case: { scope: "PRIVATE_ORIGINAL_ACCOUNT_SCOPE" } }));
          await assert.rejects(pending, { name: "AbortError" });
        } finally {
          uninstall();
        }
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
