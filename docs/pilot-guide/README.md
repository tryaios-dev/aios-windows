# AIOS pilot guide (N-03, draft)

For people taking part in the AIOS pilot. AIOS is a private AI assistant that runs on your own
computer: your projects, conversations and documents are stored encrypted on this computer, and
answers come from an AI model that runs here too. Nothing leaves the computer unless you say so.

> Draft, 17 Nov 2026. The sections marked **(to confirm)** depend on the signed pilot build
> (A-01) and are completed before the release checklist (N-04).

## 1. Before you start

- Windows 11, 64-bit. At least 16 GB of memory is recommended for the suggested model
  (to confirm on pilot hardware, M-04).
- About 10 GB of free disk space for the program and one AI model.
- An internet connection for the first model download only. Chat works offline after that.

## 2. Install

1. Run `AIOS Setup <version>.exe`. It installs for your Windows user only and needs no
   administrator rights.
2. You can choose the install folder. Downloaded AI models are kept in a `models` folder next
   to the program, so choose a drive with free space.
3. **(to confirm)** Pilot builds before code signing show "Windows protected your PC". Choose
   **More info** > **Run anyway** only for an installer you received from the AIOS team.

## 3. First start

1. AIOS creates your encrypted store and shows a **recovery key** once.
2. Write the key down or print it, and keep it somewhere safe and away from the computer. It is
   the only way to open a backup on another computer. AIOS never saves it in a file.
3. Choose where backups go (a folder, a USB stick or a network drive), or **Set up later**.

## 4. Get an AI model

1. Open **AI models**. AIOS suggests one model that fits this computer.
2. Choose **Download**. You can pause and resume. When it is installed, chat answers come from it.
3. To use a model file you already have (`.gguf`), choose it from the same page.

## 5. Everyday use

- **Projects and conversations:** create a project (Public, Internal or Confidential), then a
  conversation in it. Answers appear while they are written; **Stop** ends an answer and keeps
  the words so far.
- **My secure knowledge:** add files or a whole folder (PDF, Word, Excel, PowerPoint, text). A
  copy is stored encrypted; your original is never changed. Pick documents in the chat box to
  ask questions about them.
- **Add skills to my AI:** add a skill (for example Meeting minutes or Chart maker) and switch
  it on or off. You can also add your own `.aios-skill` file.
- **Search (Ctrl K):** finds words in every conversation, and documents by name.
- **Activity:** a signed record of what AIOS did (never the content). You can save a copy for
  an auditor.

## 6. Backups and restore

- **Settings > Backup > Back up now** copies your encrypted data to the backup folder.
- **Settings > Backup > Restore from a backup** opens a backup with your recovery key, on this
  computer or a new one.
- **Settings > Create a new recovery key** if the old one may have been seen. Back up again
  afterwards: older backups still need the old key.

## 7. If something goes wrong

- AIOS restarts its background service by itself if it stops. If it keeps stopping, you are asked
  to **Restart** or **Quit**.
- **Settings > Troubleshooting > Create a diagnostic file** makes a zip of the log files. Logs
  never contain your messages, documents or keys. Send it to support only when asked.
- Known issues: [known-issues.md](known-issues.md). Support: [support.md](support.md).

## 8. Uninstall

Uninstall from Windows Settings > Apps. You are asked whether to also remove your AIOS data;
the default is **No**, which keeps your projects, conversations and models so a later install
(or a restore with your recovery key) can use them.
