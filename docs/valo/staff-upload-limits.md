# The staff upload's limits

A Content editor may give a staff-library draft its text as a Word or PDF file. Customers upload no
file in R1: the specification keeps uploads for R2. This note records what the API accepts from the
staff upload, and what happens to a file it refuses, for OWASP ASVS 5.0.0 V5.1.1 to V5.2.3 and V1.5.1
in the [security baseline](../architecture/security-baseline.md), part 5 of
[small hardening](../architecture/small-hardening.md) (slice 3b). The limits are in the code
(`artifacts/api-server/src/modules/manual-library/files.ts`, and the library's route for the request),
and `files.test.ts` gives the upload a file past each of them.

## What is accepted

- **The request:** JSON of the draft's own media type, `application/vnd.valo.manual-draft+json`, of
  up to 3 MB, never compressed. Every other request to the API may be 128 KB at most.
- **The file:** its bytes as base64, of at most 2 MB, written exactly as base64 writes them.
  - Text longer than 2 MB of base64 can be is answered 413, before it is decoded.
  - An empty file, one over 2 MB, or one not written as plain base64 is answered 422.
- **A Word file** (`.docx`), unpacked within these limits, each counted before a part is expanded:
  - at most 300 parts, holding at most 12 MB once expanded, with no part named twice;
  - no part whose name climbs out of the package (`..`, `\` or a leading `/`);
  - no macro, ActiveX control, embedded object or program;
  - its document and its content types present, as a Word document's;
  - neither the document nor the content types declaring a document type or an entity (`<!DOCTYPE`,
    `<!ENTITY`);
  - no relationship to anything outside the file but a hyperlink.
- **A PDF:** a file that begins `%PDF-`, of at most 100 pages, not encrypted, with no JavaScript and
  no embedded files, as `pdfinfo` and `pdfdetach` report. Each reader may take 8 seconds and give
  512 KB.
- **The text** the file holds, as the draft's text: up to 60,000 characters, with no control
  characters.

## How a Word file's text is read

Valo runs no XML parser on an upload. It reads the document's paragraphs with patterns, decodes only
XML's five named entities and numeric references, and leaves any other entity as it is written. No
entity, external or internal, is ever expanded; refusing a declared one keeps the document plain.

## What happens to a refused file

- It is refused before the draft's transaction starts, with 413 or 422 and a sentence that says what
  to upload instead.
- Nothing of it is stored. The request's log line holds its method, its status and its route, never
  the file.
- A PDF is read from a copy in a folder of its own, made for the API's user alone. The folder is
  removed whether the file is accepted or not.
- When the PDF readers are missing, the upload is answered 503, and the text can be pasted instead.

## What is not done

- No antivirus scanner reads an accepted file (v5.0.0-5.4.3).
- An accepted file is kept in the database with its draft, and is only ever sent back as an
  attachment, with `nosniff`.
