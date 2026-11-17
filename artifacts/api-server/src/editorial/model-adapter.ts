import {
  managedCompletion,
  managedInferenceLane,
  assertManagedInferenceAvailable,
  parseBoundedProviderJSON,
} from "../modules/ai";
import { z } from "zod";
import {
  candidateSchema,
  reviewSchema,
  editorialModel,
  systemPrompt,
  type EditorialRole,
} from "./pipeline-contract";
import { draftSelectionSchema, resolveDraftSelection } from "./citation-selection";
export async function callEditorialModel(role: EditorialRole, input: unknown) {
  assertManagedInferenceAvailable();
  const schema = role === "draft" ? draftSelectionSchema : reviewSchema;
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  delete jsonSchema.$schema;
  const started = performance.now();
  const response = await managedCompletion(
    managedInferenceLane("publication"),
    {
      model: editorialModel,
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt(role) },
        { role: "user", content: JSON.stringify(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: role === "draft" ? "valo_editorial_candidate" : "valo_editorial_review",
          strict: true,
          schema: jsonSchema,
        },
      },
      // No tools or customer/private-workspace context is supplied.
    },
    { timeout: 45000, maxRetries: 0 },
  );
  if (response.choices[0]?.finish_reason !== "stop" || !response.choices[0]?.message.content)
    throw Error("AI_OUTPUT_INCOMPLETE");
  let output: unknown, providerOutput: unknown;
  try {
    providerOutput = schema.parse(parseBoundedProviderJSON(response.choices[0].message.content));
    output = role === "draft" ? resolveDraftSelection(providerOutput, input) : providerOutput;
    if (role === "draft") candidateSchema.parse(output);
  } catch {
    throw Error("AI_OUTPUT_SCHEMA_INVALID");
  }
  return {
    output,
    providerOutput,
    providerResponseId: response.id,
    providerRequestId: response._request_id ?? null,
    actualModel: response.model,
    latencyMs: Math.round(performance.now() - started),
    inputTokens: response.usage?.prompt_tokens ?? null,
    outputTokens: response.usage?.completion_tokens ?? null,
  };
}
