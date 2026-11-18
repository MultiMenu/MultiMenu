# Third-party notices

MultiMenu is MIT-licensed (see `LICENSE`). It uses or learned from the projects below. Thank you to their authors.

MultiMenu is not affiliated with, endorsed by, or sponsored by Roblox Corporation.

## Learned from

### RoALT 1.1.0
MIT License, Copyright (c) 2026 inspectsoftware.

MultiMenu 2.0's **Alt performance** page (its presets and the lighter-rendering options) was designed after studying RoALT's performance features, which served as a technical reference for which Roblox Fast Flags and settings to offer. MultiMenu only uses flags on Roblox's allowlist for local client configuration.

Since 2.0.1, MultiMenu's **tiny windows** are adapted from RoALT's source: making a Roblox window smaller than Roblox allows (`free_resize` in `src-tauri/src/instances/window.rs`, now `freeResize` in `src/main/native/win32.js`) and keeping tiny windows tiny (`keep_tiny` and `sweep`, now `src/main/modules/tinykeep.js`). The rest of MultiMenu's code and interface is its own, and no RoALT artwork is included. RoALT's licence is below.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Included

| Component | Used for | License |
|---|---|---|
| [Electron](https://www.electronjs.org/) | The app itself | MIT |
| [koffi](https://koffi.dev/) | Calling Windows APIs (windows, processes, eco mode) | MIT |
| [nodemailer](https://nodemailer.com/) | Email alerts | MIT-0 |
| [qrcode](https://github.com/soldair/node-qrcode) | The phone dashboard QR code | MIT |
| [Lucide](https://lucide.dev/) icons | Every icon in the interface | ISC, see `docs/LUCIDE-LICENSE.txt` |
| [Inter](https://rsms.me/inter/) and [Space Grotesk](https://floriankarsten.github.io/space-grotesk/) fonts | Interface text | SIL Open Font License 1.1, see `docs/FONTS-OFL-LICENSE.txt` |
| [PresentMon](https://github.com/GameTechDev/PresentMon) (optional, not bundled) | Measuring FPS if you point MultiMenu at it | MIT |

## Services MultiMenu can talk to (only when you turn them on)
Roblox (sign-in, launching, server lists), GitHub (updates and the theme gallery list), Discord (webhooks and your own bot), Telegram, ntfy, Pushover, and the email server you choose. MultiMenu never sends logins, cookies or passwords to any of them.
