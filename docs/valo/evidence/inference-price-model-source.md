For the complete documentation index, see [llms.txt](https://developers.openai.com/llms.txt). Markdown versions of documentation pages are available by appending
`.md` to the page URL.

## Search the API docs

Search docs

### Suggested

response\_formatreasoning\_effortstreamingtools

Primary navigation

## Choose language

[English](https://developers.openai.com/api/docs/models/gpt-5.4-mini) [简体中文Chinese (Simplified)](https://developers.openai.com/zh-Hans/api/docs/models/gpt-5.4-mini) [繁體中文Chinese (Traditional)](https://developers.openai.com/zh-Hant/api/docs/models/gpt-5.4-mini) [FrançaisFrench](https://developers.openai.com/fr-FR/api/docs/models/gpt-5.4-mini) [DeutschGerman](https://developers.openai.com/de-DE/api/docs/models/gpt-5.4-mini) [日本語Japanese](https://developers.openai.com/ja-JP/api/docs/models/gpt-5.4-mini) [한국어Korean](https://developers.openai.com/ko-KR/api/docs/models/gpt-5.4-mini) [Português (Brasil)Portuguese (Brazil)](https://developers.openai.com/pt-BR/api/docs/models/gpt-5.4-mini) [Español (Latinoamérica)Spanish (Latin America)](https://developers.openai.com/es-419/api/docs/models/gpt-5.4-mini)

Theme Light  Dark  System

Search docs

### Suggested

response\_formatreasoning\_effortstreamingtools

Overview  Models  Agents  Tools  Audio & voice  Production  API reference

DocsModels

- [Model catalog](https://developers.openai.com/api/docs/models)

### Choose a model

- [Pricing](https://developers.openai.com/api/docs/pricing)
- [Model selection](https://developers.openai.com/api/docs/guides/model-selection)

### Text and code

- [Text generation](https://developers.openai.com/api/docs/guides/text)
- [Code generation](https://developers.openai.com/api/docs/guides/code-generation)
- [Structured output](https://developers.openai.com/api/docs/guides/structured-outputs)

### Prompting

- [Overview](https://developers.openai.com/api/docs/guides/prompting)
- [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
- [Citation formatting](https://developers.openai.com/api/docs/guides/citation-formatting)
- [Migration guide](https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object)
- [Prompt generation](https://developers.openai.com/api/docs/guides/prompt-generation)
- [Frontend prompting](https://developers.openai.com/api/docs/guides/frontend-prompt)

### Reasoning

- [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)

### Images

- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)

  - [Image input cost calculator](https://developers.openai.com/api/docs/guides/image-cost-calculator)

- [Image generation](https://developers.openai.com/api/docs/guides/image-generation)

  - [Overview](https://developers.openai.com/api/docs/guides/image-generation)
  - [Image prompting](https://developers.openai.com/api/docs/guides/image-prompting)

### Realtime and audio

- [Audio and speech](https://developers.openai.com/api/docs/guides/audio)
- [Getting started](https://developers.openai.com/api/docs/guides/realtime)
- [Voice agents](https://developers.openai.com/api/docs/guides/voice-agents)

### Specialized models

- [Embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- [Moderation](https://developers.openai.com/api/docs/guides/moderation)

[API Dashboard](https://platform.openai.com/login)

[Try ChatGPT](https://chatgpt.com/)

[Models](https://developers.openai.com/api/docs/models)

![gpt-5.4-mini](https://developers.openai.com/images/api/models/icons/gpt-5.4-mini.png)

GPT-5.4 mini

`gpt-5.4-mini-2026-03-17`

Our strongest mini model yet for coding, computer use, and subagents

Our strongest mini model yet for coding, computer use, and subagents

CompareTry in Playground

Reasoning

Higher

Speed

Fast

Price

$0.75•$4.5

Input•Output

Input

Text, Image

Output

Text

GPT-5.4 mini brings the strengths of GPT-5.4 to a faster, more efficient
model designed for high-volume workloads. Learn more in our
[Model guidance](https://developers.openai.com/api/docs/guides/latest-model) page. Reasoning.effort supports: none (default), low, medium, high and xhigh.

400,000 context window

128,000 max output tokens

Aug 31, 2025 knowledge cutoff

Reasoning token support

Pricing

Pricing is based on the number of tokens used, or other metrics based on the model type. For tool-specific models, like search and computer use, there’s a fee per tool call. See details in the [pricing page](https://developers.openai.com/api/docs/pricing).

Text tokens

Per 1M tokens

∙

Batch API price

Input

$0.75

Cached input

$0.075

Output

$4.50

Quick comparison

Input

Cached input

Output

GPT-5.4

$2.50

GPT-5.4 mini

$0.75

GPT-5.4 nano

$0.20

Regional processing (data residency) endpoints are charged a 10% uplift for GPT-5.4 mini.

Modalities

Text

Input and output

Image

Input only

Audio

Not supported

Video

Not supported

Endpoints

Live

v1/live/sessions

Chat Completions

v1/chat/completions

Responses

v1/responses

Realtime

v1/realtime

Realtime translation

v1/realtime/translations

Realtime transcription

v1/realtime/transcription\_sessions

Assistants

v1/assistants

Batch

v1/batch

Fine-tuning

v1/fine-tuning

Embeddings

v1/embeddings

Image generation

v1/images/generations

Videos

v1/videos

Image edit

v1/images/edits

Speech generation

v1/audio/speech

Transcription

v1/audio/transcriptions

Translation

v1/audio/translations

Moderation

v1/moderations

Completions (legacy)

v1/completions

Features

Streaming

Supported

Function calling

Supported

Structured outputs

Supported

Fine-tuning

Not supported

Tools

Tools supported by this model when using the Responses API.

Web search

Supported

File search

Supported

Image generation

Supported

Code interpreter

Supported

Hosted shell

Supported

Apply patch

Supported

Skills

Supported

Computer use

Supported

MCP

Supported

Tool search

Supported

Snapshots

Snapshots let you lock in a specific version of the model so that performance and behavior remain consistent. Below is a list of all available snapshots and aliases for GPT-5.4 mini.

![gpt-5.4-mini](https://developers.openai.com/images/api/models/icons/gpt-5.4-mini.png)

gpt-5.4-mini

gpt-5.4-mini-2026-03-17

gpt-5.4-mini-2026-03-17

Rate limits

Rate limits ensure fair and reliable access to the API by placing specific caps on requests, tokens, audio duration, or other usage within a given time period. Your usage tier determines how high these limits are set and automatically increases as you send more requests and spend more on the API.

| Tier | RPM | TPM | Batch queue limit |
| --- | --- | --- | --- |
| Free | Not supported |
| Build | 5,000 | 2,000,000 | 20,000,000 |
| Launch | 10,000 | 10,000,000 | 1,000,000,000 |
| Grow | 30,000 | 180,000,000 | 15,000,000,000 |

Ask AI

Loading docs agent...