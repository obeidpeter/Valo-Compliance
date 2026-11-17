import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contractOperations, pathParameters } from "./contract-operations";

test("the contract reader finds every declared operation and nothing else", () => {
  const text = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");
  const operations = contractOperations(text);
  // Independent of layout: every operation in the contract has exactly one operationId.
  const pathsSection = text.slice(text.indexOf("\npaths:"), text.indexOf("\ncomponents:"));
  const operationIds = pathsSection.match(/"?operationId"?\s*:/g) ?? [];
  assert.equal(operations.length, operationIds.length);
  assert.equal(new Set(operations.map((o) => o.key)).size, operations.length, "no duplicates");
  assert.ok(
    operations.every((o) => o.operationId),
    "every operation has its operationId",
  );
  assert.equal(new Set(operations.map((o) => o.operationId)).size, operations.length, "IDs are unique");
  assert.equal(
    operations.find((o) => o.key === "POST /workspace/orders/{orderId}/concerns")?.operationId,
    "createPaymentConcern",
  );
  assert.equal(
    operations.find((o) => o.key === "GET /workspace/assessments/{id}/compare/{previousId}")?.operationId,
    "compareAssessments",
  );
  for (const known of [
    "GET /workspace/documents/{id}",
    "PATCH /workspace/tasks/{id}",
    "GET /workspace/assessments/{id}/compare/{previousId}",
    "POST /v1/documents/{id}/exports",
    "POST /workspace/orders/{orderId}/concerns",
  ])
    assert.ok(
      operations.some((o) => o.key === known),
      known,
    );
  assert.ok(operations.every((o) => o.path.startsWith("/")));
});

test("the reader handles inline paths and ignores keys outside paths", () => {
  const text = [
    "openapi: 3.1.0",
    "paths:",
    "  /a/{id}:",
    "    get:",
    "      operationId: readA",
    "      parameters:",
    "        get:",
    "          operationId: notAnOperation",
    "    post:",
    "  /b:",
    "    delete:",
    '  /i/{id}: {"put": {"operationId": "x"}, "parameters": []}',
    "components:",
    "  /c:",
    "    get:",
  ].join("\n");
  assert.deepEqual(
    contractOperations(text).map((o) => [o.key, o.operationId]),
    [
      ["GET /a/{id}", "readA"],
      ["POST /a/{id}", undefined],
      ["DELETE /b", undefined],
      ["PUT /i/{id}", "x"],
    ],
  );
  assert.deepEqual(pathParameters("/x/{id}/compare/{previousId}"), ["id", "previousId"]);
});
