# File Storage Rules

Use when creating, downloading, receiving, generating, moving, archiving, or documenting files for this repository, including files received through WeChat.

## Scope

- This is a prospective placement rule for new files and newly completed work.
- Do not treat this policy as authorization to reorganize the existing `downloads/` tree.
- Existing files stay where they are unless the user separately asks for a migration or cleanup task.
- Creating the folder structure and routing future files into it is part of the rule; bulk-moving historical files is a different task and requires explicit scope.

## Storage Zones

Every file must belong to exactly one of these zones. Choose the zone from the file's lifecycle and ownership, not only its extension.

| Zone | Location | Purpose |
| --- | --- | --- |
| Personal intake | `%USERPROFILE%\Downloads\00-Inbox\` | Newly downloaded files that have not been reviewed. This is temporary intake, not long-term storage. |
| Personal software | `%USERPROFILE%\Downloads\10-Installers\` | Installers, package checksums, and installation bundles retained for reuse. |
| Personal documents | `%USERPROFILE%\Downloads\20-Documents\` | Personal documents unrelated to a repository. |
| Personal media | `%USERPROFILE%\Downloads\30-Media\` | Personal images, audio, and video unrelated to a repository. |
| Personal archives | `%USERPROFILE%\Downloads\40-Archives\` | ZIP, 7z, tar, and other personal transfer bundles awaiting extraction or retention review. |
| Repository source | repository root and `src/`, `scripts/`, `rules/` | Version-controlled source, configuration templates, scripts, and operating rules. |
| Repository documents | `docs/<topic>/` | Durable research, design, plans, reports, and operator-facing documents that belong in Git. |
| Personal knowledge library | `资料库/` | The user's local document, printing, video, summary, and reference library at the repository root. |
| Repository local work | `资料库/30-视频资料/02-处理中/` or the matching knowledge-library area | Large, temporary, licensed, generated, or otherwise untracked project material. Encode topic and source in filenames instead of deeper folders. |
| Repository local archive | `资料库/60-历史归档/YYYY/` | Finished local-only project material retained for reference. Encode month and topic in filenames instead of deeper folders. |
| WeChat automatic archive | repository-root `资料库/` | Supported inbound WeChat attachments are downloaded, decrypted, and written directly to the matching personal-library category. |
| WeChat runtime output | `%USERPROFILE%\.wechat-codex\files\outbox\YYYY\MM\<peer-hash>\<type>\` | Files generated for sending through WeChat. |
| Disposable runtime files | operating-system temporary directory | Short-lived decoded images, conversion intermediates, and retry-safe files that need not survive restart. |

For runtime output, `<type>` is one of `documents`, `images`, `audio`, `video`, `archives`, or `other`. Use a stable non-reversible peer hash; do not expose a contact's display name, account id, phone number, or other personal identifier in a path.

## Personal Knowledge Library

`资料库/` is the default local home for reusable personal material handled through this repository. It is a direct child of the repository root, outside `downloads/`:

```text
资料库/
  00-待分类/                  # ownership or purpose is not yet clear
  10-待打印/
    待确认/                   # likely printable, but user intent is not confirmed
    已打印归档/               # optional retained print masters
  20-知识文档/
    量化交易/
    AI与开发/
    健康/
    个人与职业/
    其他/
  30-视频资料/
    01-原视频/                # immutable originals
    02-处理中/                # active task evidence and derivatives
    03-证据归档/              # completed transcripts, metadata, frames, audio
    90-历史任务/              # retained older task material
  40-整理总结/
    视频总结/                 # final video briefings in one discoverable place
    专题研究/                 # synthesis spanning one or more sources
    其他总结/
  50-工具与安装包/
  60-历史归档/
    YYYY/
```

### Maximum depth

- Inside `资料库/`, allow at most two directory levels: `一级分类/二级分类/文件`.
- `30-视频资料/03-证据归档/文件` is the maximum permitted nesting pattern.
- Never create a topic, source, month, task, or artifact-type folder beneath a second-level directory. Put that context in the filename instead.
- If a received package requires its own internal folder hierarchy to remain usable, keep the original ZIP/7z/tar package in `50-工具与安装包/` rather than expanding it into deeper library folders.
- When flattening an existing path, never overwrite a same-name file. Add former path context or a short content hash to the filename.

- A document requested only for printing goes to `10-待打印/`; it is not automatically promoted into the knowledge base.
- When print intent is uncertain, use `10-待打印/待确认/` and preserve any related source files together.
- Reusable reference documents go to `20-知识文档/` by subject, regardless of whether their format is PDF, Markdown, image, or text.
- Final video summaries always go to `40-整理总结/视频总结/`; do not leave the only final summary inside a working-evidence folder.
- Multi-source analysis or follow-up research goes to `40-整理总结/专题研究/`.
- `00-待分类/` must remain an intake queue, not a permanent miscellaneous folder.

### Automatic WeChat placement

Inbound WeChat attachments are classified without creating contact or message subdirectories:

| Attachment | Automatic destination |
| --- | --- |
| Video items and video file extensions | `30-视频资料/01-原视频/` |
| PDF, Office, text, Markdown, spreadsheet, ebook, and similar documents | `20-知识文档/其他/` |
| ZIP, 7z, tar, installer, APK, and similar packages | `50-工具与安装包/` |
| Images, audio, unknown extensions, or files whose purpose cannot be inferred safely | `00-待分类/` |

- Automatic placement uses the configured Codex working directory as the repository root.
- An image is downloaded only once: the same decrypted bytes are saved to the library and forwarded to Codex as image input.
- A video or document path is appended to the Codex task so a file-only WeChat message can still be processed.
- If a voice item contains downloadable CDN media, archive the media under `00-待分类/`; otherwise continue using WeChat's transcription and do not invent an audio file.
- Do not automatically persist obvious credential containers such as `.env`, `.pem`, `.key`, `.p12`, or `.pfx` files.

## Video Task Layout

Video work uses filenames, not per-topic subdirectories:

```text
资料库/
  30-视频资料/
    01-原视频/YYYY-MM-DD-source-topic.mp4
    02-处理中/YYYY-MM-DD-topic-transcript.txt
    02-处理中/YYYY-MM-DD-topic-contact-sheet.jpg
    02-处理中/YYYY-MM-DD-topic-metadata.json
    03-证据归档/YYYY-MM-DD-topic-transcript.txt
  40-整理总结/
    视频总结/YYYY-MM-DD-topic-summary.md
```

- Put the completed briefing in `40-整理总结/视频总结/`; put durable repository documentation in `docs/<topic>/` only when it belongs to the software project itself.
- Keep source media immutable. Derivatives belong in `02-处理中/` while active and `03-证据归档/` when complete.
- Do not place credentials, cookies, tokens, `.env` files, or decrypted private data in manifests or repository storage.
- Do not create a second copy when a short path reference is enough. If a provenance note is required, use a matching `YYYY-MM-DD-topic-manifest.md` file in the same second-level directory.

## Classification Workflow

Apply this workflow when a new file arrives or a new output is created:

1. Land browser and manual downloads in `Downloads\00-Inbox`; archive supported WeChat attachments directly into the matching root-level `资料库/` category.
2. Inspect ownership, topic, sensitivity, and expected lifetime before moving the file.
3. Move reusable personal material into root-level `资料库/`; move software-project source and docs into their repository-native locations.
4. Put printable-only documents in `10-待打印/`, reusable references in `20-知识文档/`, source videos and evidence in `30-视频资料/`, and completed summaries in `40-整理总结/`.
5. When a video task is finished, move its evidence to `30-视频资料/03-证据归档/` and keep its final briefing in `40-整理总结/视频总结/`; encode the topic in filenames.
6. When other material is finished but still worth retaining locally, move it to `60-历史归档/YYYY/`; encode month and topic in filenames.
7. Review intake folders weekly. Files older than 30 days must be classified, archived, or explicitly marked for deletion; deletion still requires confirmation when ownership or value is unclear.

## Naming

- Prefer `YYYY-MM-DD-source-topic-description.ext` for received or downloaded originals.
- Prefer `topic-description-vN.ext` for working derivatives and outputs.
- Preserve the original filename for WeChat file attachments when it is filesystem-safe. Media without an original filename uses `YYYY-MM-DD-wechat-<message-id>-<index>.ext`, with the extension detected from the decrypted bytes.
- Avoid ambiguous suffixes such as `(1)`, `final-final`, `new`, or `copy`.

### Extension immutability

- Treat the final extension, including its original letter case, as immutable metadata for every existing or received library file.
- Moving, flattening, classifying, or collision-renaming a file must never drop or change its extension.
- Insert collision or former-path context before the extension: `report.pdf` becomes `report-2.pdf`, never `report.pdf-2` or `report-2.txt`.
- A content conversion creates a separate derivative with the correct new extension; it never masquerades as a rename of the original and never replaces the original automatically.
- Files without an extension remain extensionless. Do not guess or append an extension unless the format is verified and the user explicitly requests correction.
- When the received original name contains an invalid or unsafe extension that cannot be represented without changing it, reject automatic archival and report the failure instead of silently rewriting the suffix.

## Current Runtime Behavior

The bridge automatically persists supported inbound WeChat images, videos, voice media, and file attachments in repository-root `资料库/`. It keeps file extensions unchanged, prevents overwrite through a suffix-before-extension collision name, and passes saved paths to Codex. Text-only voice messages still use WeChat's transcription; unsupported or missing CDN payloads are reported rather than represented as fabricated files.

## Safety

- Do not move historical files merely because this rule has been introduced.
- Never reorganize existing files in bulk without first producing a dry-run inventory and resolving collisions.
- Never overwrite a same-name file. Add an explicit version or content hash.
- Never change or remove a library file's extension as part of a move or rename.
- Never delete originals merely because a processed copy exists unless retention and recoverability were verified.
- Keep both `downloads/` and root-level `资料库/` ignored by Git; personal knowledge-library contents are local by default and must not be committed accidentally.
