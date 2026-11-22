# Preparing industry guides for editorial review

Valo has an introduction for each of its 20 industry pages. Retail and wholesale, packaged-food manufacturing, restaurants and hospitality, technology and software, professional services, and beauty and personal care each also have a five-step draft. Both kinds of draft need an individual editorial decision.

## Prepare and verify a private copy

Run these commands from a development checkout. Give both commands the same absolute file path in an existing private directory. The operator uses local source files and needs no credentials or running services.

```sh
NODE_ENV=development pnpm --filter @workspace/api-server valo:industry-guide-reviews prepare /absolute/private/path/industry-guides.json
NODE_ENV=development pnpm --filter @workspace/api-server valo:industry-guide-reviews verify /absolute/private/path/industry-guides.json
```

The result contains 26 records in website category order. A longer guide follows its introduction. Each record carries the intended industry page, the draft text, the original heading and hash, the retained authoring evidence, the proposed template references and the author's research notes. The checks compare the packet to the exact retained texts and taxonomy. Repeating preparation accepts an identical packet and preserves existing files that differ.

## Use the review briefs

Give each reviewer the candidate, its hash and their own brief. The factual reviewer checks the steps, references and any claims about obligations. The challenge reviewer independently looks for situations where the advice could mislead someone. Collect both assessments against the same candidate hash, including affected passages and outstanding evidence. For healthcare, energy and financial services the packet carries the taxonomy's enhanced evidence requirement.

The original author marked the official links as research leads. A legal claim requires applicable source passages and currentness evidence. Proposed template connections need eligible versions and the appropriate access before they can become public links. Rights clearance, other applicable editorial gates and any subsequent publication decision belong to each candidate separately.

The packet records preparation only. Provider review, budget reservation and publication are separate operations. The command supports `prepare` and `verify` in a non-deployed development runtime. It writes the named local file and does not enqueue a job.

[Original industry drafts](../content-candidates/industry-content-candidates.md) · [Authoring and rights evidence](../content-candidates/chatgpt-content-provenance-rights.md) · [Content inventory](../registers/content-inventory.json)
