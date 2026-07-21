# Privacy Policy

Audio Recorder records audio only after the user clicks the recording button and grants microphone permission in Chrome.

## Data Collection

This extension does not collect, sell, transmit, or share personal data.

## Audio Data

Audio is processed locally in the browser. Recordings are kept in memory until the user downloads them or starts over. The extension does not upload recordings automatically.

## Local Storage

The extension stores local preferences in the browser, including bitrate, file naming settings, saved links, copy preference, start date, and the automatic MP3 download toggle.

## Network Access

The extension does not call a remote recording or upload API. The "open links" feature opens links explicitly configured by the user or listed in `links.txt`.

## Google Drive

The current version does not implement Google Drive upload or OAuth. If Google Drive upload is added in the future, it should use the minimum required scope such as `drive.file` and must not include an OAuth Client Secret in the extension package.

