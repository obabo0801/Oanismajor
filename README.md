<p align="center">
  <img src="https://img.shields.io/badge/node.js-24%2B-brightgreen" alt="Node.js 24+">
  <img src="https://img.shields.io/badge/version-v1.0.0-blue" alt="Version 1.0.0">
</p>

<h1 align="center">🐶 oanismajor</h1>

<p align="center">
  <img src="https://github.com/user-attachments/assets/c4f849a2-839f-4ec1-9f3c-2b837e8518f7" width="16%" alt="oanismajor">
</p>

<p align="center">
  <a href="https://github.com/obabo0801/Oanismajor/archive/refs/heads/main.zip">
    <img src="https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge" alt="Download ZIP">
  </a>
</p>

---

<details>
<summary><strong>한국어</strong></summary>

### 📌 소개

채팅, 음성, 알림, 사용자 관리를 제공하는<br>
Node.js 웹 프로젝트입니다.<br>
데스크탑, 모바일, 웨어러블을 지원합니다.

<details>
<summary>✨ 기능</summary>

| 구분 | 기능 |
| :---: | :---: |
| 화면 | 테마, 다국어 |
| 사용자 | 로그인, 프로필, 접속 상태 |
| 채팅 | 채팅방, 메신저, 첨부파일 |
| 문의 | 접수, 담당자 배정, 내역 관리 |
| 알림 | 화면 알림, Web Push |
| 음성 | TTS, STT |
| PWA | 앱 설치, 오프라인 안내 |

첨부파일은 파일당 최대 500MB를 지원합니다.<br>
오디오와 동영상을 재생하고 커버, 제목을 편집합니다.<br>
호환되지 않는 미디어는 서버에서 변환합니다.<br>
WAS 설치에는 FFmpeg가 포함됩니다.

`/`에서 방을 선택합니다. 방 주소는 `/rooms/:id`이며,<br>
이름을 바꿔도 유지됩니다.

| 방 상태 | 접근 | 작성 |
| :---: | :---: | :---: |
| 공개 | 누구나 | 가능 |
| 읽기 전용 | 누구나 | 불가 |
| 보관 | 관리자 | 불가 |

관리자는 방을 생성하거나 수정할 수 있습니다.<br>
방 삭제는 보관으로 처리하며 메시지를 유지합니다.

</details>

<details>
<summary>🚀 실행</summary>

소스를 내려받고 프로젝트 폴더에서 실행합니다.

```bash
git clone https://github.com/obabo0801/Oanismajor.git
cd Oanismajor
```

| 환경 | 실행 |
| :---: | :---: |
| Windows 11 | `.\oanismajor.bat` |
| Ubuntu | `sudo bash oanismajor.sh` |

1. 처음에는 WAS, WEB, DB를 설치합니다.
2. Tailscale에 로그인합니다.
3. 새 서버 또는 기존 서버 연결을 선택합니다.
4. 메뉴의 **시작**에서 실행할 서비스를 선택합니다.

WSL 설치로 재부팅했다면 다시 실행합니다.<br>
이후 실행부터는 관리 메뉴가 열립니다.<br>
메뉴 언어는 **설정**에서 변경합니다.

**개별 실행**

**Windows**

| 작업 | 명령 |
| :---: | :---: |
| 시작 | `.\start.bat` |
| 정지 | `.\stop.bat` |
| 재시작 | `.\restart.bat` |
| 상태 | `.\status.bat` |
| 로그 | `.\logs.bat` |
| 업데이트 | `.\update.bat` |

**Ubuntu**

| 작업 | 명령 |
| :---: | :---: |
| 시작 | `sudo bash start.sh` |
| 정지 | `sudo bash stop.sh` |
| 재시작 | `sudo bash restart.sh` |
| 상태 | `sudo bash status.sh` |
| 로그 | `sudo bash logs.sh` |
| 업데이트 | `sudo bash update.sh` |

끝에 `was`, `web`, `db`를 붙이면 해당 서비스를<br>
선택합니다.<br>
예: `.\stop.bat was`, `sudo bash stop.sh was`

Node.js가 있으면 npm 명령도 사용할 수 있습니다.

```bash
npm start
npm stop was
npm run restart web
npm run status
npm run logs
```

로그 화면은 Ctrl+C로 닫습니다. 서버는 계속 실행됩니다.

**업데이트**

`git pull`후 업데이트를 실행합니다.<br>
실행 중인 WAS, WEB만 갱신합니다.<br>
정지된 서버는 켜지 않으며 DB는 재시작하지 않습니다.<br>
포트나 서버 구성 변경은 설치 절차로 적용합니다.

**제거**

`uninstall.bat`또는 `sudo bash uninstall.sh`를<br>
실행합니다.<br>
DB, 업로드, 설정, 인증서는 유지됩니다.

</details>

<details>
<summary>🛠 패키지</summary>

- Node.js 24 이상, npm
- ES Modules, Express 5
- Vite 8
- PostgreSQL 18
- ESLint 10, Prettier 3

DB와 프로젝트 루트의 `.env`를 준비합니다.<br>
기본 DB 이름은 `oanismajor`, 계정은 `root`입니다.

```bash
npm ci
npm run dev
```

`http://localhost:5173`에 접속합니다. 종료는<br>
Ctrl+C입니다.

| 명령 | 용도 |
| :---: | :---: |
| `npm run build` | `web/dist`빌드 |
| `npm run preview` | 빌드 미리보기 |
| `npm run format` | 코드 정리 |

</details>

<details>
<summary>🔐 설정</summary>

프로젝트 루트의 `.env`를 사용합니다.<br>
설치와 업데이트 시 운영 폴더에 반영됩니다.<br>
새 기본 서버 설치 시 DB 비밀번호와 쿠키 키를<br>
생성합니다.

```env
DATABASE_URL=postgresql://root:YOUR_PASSWORD@127.0.0.1:5432/oanismajor
COOKIE_SECRET=YOUR_RANDOM_SECRET
HTTPS_HOST=example.com
HTTPS_EMAIL=admin@example.com
```

`.env`, 인증 파일, 비밀 키는 Git에 올리지 않습니다.<br>
운영 환경에서는 `NODE_ENV=development`를 사용하지<br>
않습니다.

**Google**

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5173/api/04f8996d/google/callback
```

실제 접속 주소의 콜백 URL을 Google에도 동일하게<br>
등록합니다.<br>
여러 주소는 쉼표로 구분합니다.

**SOOP**

```env
SOOP_CLIENT_KEY=
SOOP_SECRET_KEY=
SOOP_REDIRECT_URI=https://example.com/api/04f8996d/soop/callback
SOOP_CONSENT=false
SOOP_ENABLED=false
```

실제 콜백 URL을 SOOP Developers에도 등록합니다.

- `user_stationinfo`, `validate_live_status`승인 후
  `SOOP_CONSENT=true`
- SOOP의 `state`반환 지원 확인 후 `SOOP_ENABLED=true`

승인 전에는 해당 API를 호출하지 않습니다.<br>
콜백의 `state`검증은 유지합니다.<br>
Consent 신청에는 홈페이지, 개인정보처리방침, 기능<br>
설명이 필요합니다.<br>
재로그인과 계정 연결은 기존 프로필을 유지합니다.

**음성**

```env
TTS=json
STT=json
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

`json`은 서비스 계정 파일, `login`은 Cloud 기본<br>
인증을 사용합니다.<br>
빈 값이면 TTS는 일반 Google TTS, STT는 Cloud<br>
비활성화입니다.

Cloud 프로젝트에서 사용할 음성 API를 활성화하고<br>
인증 계정의 권한과 결제 설정을 확인합니다.

WAS 설치에는 gcloud가 포함됩니다.<br>
`login`방식은 Ubuntu에서 인증합니다.

```bash
export CLOUDSDK_CONFIG=/srv/oanismajor/.config/gcloud
gcloud auth application-default login
```

**Web Push**

`npx web-push generate-vapid-keys`로 키를 생성합니다.

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

**GIPHY**

`VITE_GIPHY_API_KEY`에 공개 검색 키를 설정한 뒤<br>
빌드합니다.

**연결 상태**

`status`에서 HTTPS, TTS, STT, GOOGLE, SOOP, VAPID,<br>
GIPHY를 확인합니다.<br>
관리자의 **연결 상태**에서는 인증서 발급일과 만료일도<br>
확인합니다.<br>
실제 로그인과 푸시 수신은 사용하는 기기에서<br>
확인합니다.

</details>

<details>
<summary>🌐 증설</summary>

**추가 서버**

1. 기본 서버를 켜고 같은 Tailscale 계정에 연결합니다.
2. 같은 소스 버전, 기본 서버의 `.env`, `web/dist`를<br>
  준비합니다.
3. 설치에서 기존 서버 연결을 선택합니다.
4. 기본 서버의 Tailscale IP를 입력합니다.

`local.json`, `node_modules`, `storage`는 복사하지<br>
않습니다.<br>
DB 복제에는 `REPLICATION_URL`, 음성 WAS에는 Cloud<br>
인증이 필요합니다.<br>
서버 간 쿠키 키와 로그인 설정, 푸시 키는 동일하게<br>
사용합니다.

**분산과 전환**

- WEB, WAS는 정상 응답 후 등록됩니다.
- 지원하는 조회는 최신 복제 DB에 분산합니다.
- 복제 지연이나 오류가 있으면 기본 DB에서 조회합니다.
- 저장과 권한 확인은 기본 DB를 사용합니다.
- 복제 DB가 연결되면 동기 복제, 끊기면 단독 저장으로<br>
  전환합니다.
- 자동 인계 설정 시 재부팅 전에 역할을 넘깁니다.
- 기본 서버가 돌아오면 동기화 후 주 역할을 복구합니다.
- Router 전환 중 잠시 지연될 수 있습니다.
- 갑작스러운 전원 차단이나 통신 단절만으로 DB를<br>
  승격하지 않습니다.

**기본 포트**

| 역할 | 포트 |
| :---: | :---: |
| HTTPS | 80, 443 |
| WEB | 8081 |
| WAS | 3001 |
| DB | 5432 |
| 파일 공유 | 2049 |

외부 HTTPS 연결과 서버 간 Tailscale 연결에 필요한<br>
포트를 허용합니다.

**백업**

- DB: `pg_dump`
- 업로드: `storage/`
- 설정: 운영 `.env`, Cloud 인증 파일
- 인증서: `/var/lib/oanismajor/acme`

인증서 폴더는 유지합니다.<br>
`evidence`복구에는 `storage/evidence.key`가<br>
필요합니다.

</details>

<details>
<summary>📁 구조</summary>

| 경로 | 용도 |
| :---: | :---: |
| `was/` | 서버 |
| `web/` | 화면 |
| `db/` | 데이터베이스 |
| `lib/` | 공용 코드 |
| `storage/` | 저장 파일 |
| `web/dist/` | 빌드 결과 |
| `servers.json` | 기본 설정 |
| `local.json` | 개별 설정 |
| `run.js` | 실행 도구 |

`local.json`이 기본 설정보다 우선합니다.<br>
운영 소스는 `/srv/oanismajor`, Nginx 설정은<br>
`/etc/oanismajor`입니다.

Windows에서 운영 파일을 확인하는 경로입니다.

```text
\\wsl.localhost\Ubuntu\srv\oanismajor
```

</details>

</details>

<details>
<summary><strong>English</strong></summary>

### 📌 About

A Node.js web project for chat, voice, notifications,<br>
and user management.<br>
Supports desktop, mobile, and wearable screens.

<details>
<summary>✨ Features</summary>

| Area | Features |
| :---: | :---: |
| Interface | Themes, languages |
| Users | Sign-in, profiles, presence |
| Chat | Rooms, messenger<br>attachments |
| Support | Requests, assignments, history |
| Notifications | In-app alerts, Web Push |
| Voice | TTS, STT |
| PWA | App installation, offline notice |

Attachments support up to 500MB per file.<br>
Play audio and video. Edit covers and titles.<br>
Incompatible media is converted on the server.<br>
WAS installation includes FFmpeg.

Choose a room at `/`. Room URLs use `/rooms/:id`<br>
and stay unchanged when a room is renamed.

| Room state | Access | Posting |
| :---: | :---: | :---: |
| Public | Everyone | Allowed |
| Read-only | Everyone | Blocked |
| Archived | Admins | Blocked |

Admins can create and edit rooms.<br>
Deleting a room archives it and keeps its messages.

</details>

<details>
<summary>🚀 Run</summary>

Download the source and open the project folder.

```bash
git clone https://github.com/obabo0801/Oanismajor.git
cd Oanismajor
```

| Platform | Command |
| :---: | :---: |
| Windows 11 | `.\oanismajor.bat` |
| Ubuntu | `sudo bash oanismajor.sh` |

1. The first run installs WAS, WEB, and DB.
2. Sign in to Tailscale.
3. Create a new server or connect to an existing<br>
  server.
4. Select services from **Start** in the menu.

If WSL installation requires a reboot, run the command<br>
again afterward.<br>
Later runs open the management menu.<br>
Change the menu language in **Settings**.

**Individual commands**

**Windows**

| Action | Command |
| :---: | :---: |
| Start | `.\start.bat` |
| Stop | `.\stop.bat` |
| Restart | `.\restart.bat` |
| Status | `.\status.bat` |
| Logs | `.\logs.bat` |
| Update | `.\update.bat` |

**Ubuntu**

| Action | Command |
| :---: | :---: |
| Start | `sudo bash start.sh` |
| Stop | `sudo bash stop.sh` |
| Restart | `sudo bash restart.sh` |
| Status | `sudo bash status.sh` |
| Logs | `sudo bash logs.sh` |
| Update | `sudo bash update.sh` |

Append `was`, `web`, or `db` to select a service.<br>
Examples: `.\stop.bat was`, `sudo bash stop.sh was`

With Node.js installed, npm commands are also<br>
available.

```bash
npm start
npm stop was
npm run restart web
npm run status
npm run logs
```

Press Ctrl+C to close the log view. Services keep<br>
running.

**Updates**

Run `git pull`, then the update command.<br>
Only running WAS and WEB services are refreshed.<br>
Stopped services stay stopped. DB is not restarted.<br>
Use the installation flow to change ports or server<br>
roles.

**Uninstall**

Run `uninstall.bat` or `sudo bash uninstall.sh`.<br>
The database, uploads, settings, and certificates are<br>
kept.

</details>

<details>
<summary>🛠 Packages</summary>

- Node.js 24+, npm
- ES Modules, Express 5
- Vite 8
- PostgreSQL 18
- ESLint 10, Prettier 3

Prepare a database and a root `.env` file.<br>
The default database is `oanismajor`, with the `root`<br>
database user.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. Press Ctrl+C to stop.

| Command | Purpose |
| :---: | :---: |
| `npm run build` | Build to `web/dist` |
| `npm run preview` | Preview the build |
| `npm run format` | Format code |

</details>

<details>
<summary>🔐 Configuration</summary>

Use `.env` in the project root.<br>
Installation and updates copy it to the runtime<br>
folder.<br>
A new primary server generates a database password and<br>
cookie key.

```env
DATABASE_URL=postgresql://root:YOUR_PASSWORD@127.0.0.1:5432/oanismajor
COOKIE_SECRET=YOUR_RANDOM_SECRET
HTTPS_HOST=example.com
HTTPS_EMAIL=admin@example.com
```

Keep `.env`, credentials, and private keys out of<br>
Git.<br>
Do not use `NODE_ENV=development` in production.

**Google**

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5173/api/04f8996d/google/callback
```

Register the same callback URL for your deployment in<br>
Google.<br>
Separate multiple URLs with commas.

**SOOP**

```env
SOOP_CLIENT_KEY=
SOOP_SECRET_KEY=
SOOP_REDIRECT_URI=https://example.com/api/04f8996d/soop/callback
SOOP_CONSENT=false
SOOP_ENABLED=false
```

Register the actual callback URL in SOOP Developers.

- Obtain `user_stationinfo` and `validate_live_status`<br>
  approval,<br>
  then set `SOOP_CONSENT=true`.
- Confirm SOOP returns `state`, then set<br>
  `SOOP_ENABLED=true`.

These APIs are not called before approval.<br>
Keep callback `state` validation enabled.<br>
Consent applications need a homepage, privacy policy,<br>
and feature description.<br>
Later sign-ins and account linking preserve the<br>
existing profile.

**Voice**

```env
TTS=json
STT=json
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

Use `json` for a service account file or `login` for<br>
Cloud default credentials.<br>
An empty value uses standard Google TTS and disables<br>
Cloud STT.

Enable the required speech APIs in the Cloud project.<br>
Check account permissions and billing settings.

WAS installation includes gcloud.<br>
For `login`, authenticate in Ubuntu:

```bash
export CLOUDSDK_CONFIG=/srv/oanismajor/.config/gcloud
gcloud auth application-default login
```

**Web Push**

Generate keys:<br>
`npx web-push generate-vapid-keys`

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

**GIPHY**

Set the public search key in `VITE_GIPHY_API_KEY`,<br>
then rebuild.

**Connection status**

Check HTTPS, TTS, STT, GOOGLE, SOOP, VAPID, and GIPHY<br>
with `status`.<br>
The admin connection view also shows certificate issue<br>
and expiry dates.<br>
Verify actual sign-in and push delivery on the target<br>
device.

</details>

<details>
<summary>🌐 Scaling</summary>

**Additional servers**

1. Keep the primary server on and use the same<br>
  Tailscale account.
2. Prepare the same source version, `web/dist`,<br>
  and the primary server's `.env`.
3. Choose the existing server option during<br>
  installation.
4. Enter the primary server's Tailscale IP.

Do not copy `local.json`, `node_modules`, or<br>
`storage`.<br>
DB replicas need `REPLICATION_URL`. Voice WAS nodes<br>
need Cloud credentials.<br>
Use the same cookie key, login settings, and push keys<br>
across servers.

**Distribution and handover**

- WEB and WAS register after responding successfully.
- Supported reads are distributed to up-to-date<br>
  replicas.
- Delayed or unavailable replicas fall back to the<br>
  primary for reads.
- Writes and permission checks use the primary.
- Connected replicas use synchronous replication.
  A lost replica connection switches back to<br>
  standalone writes.
- Configured automatic handover transfers roles before<br>
  a restart.
- The original primary regains its role after<br>
  returning and synchronizing.
- Router switching may cause a brief delay.
- Sudden power loss or lost connectivity alone does<br>
  not promote a DB.

**Default ports**

| Role | Port |
| :---: | :---: |
| HTTPS | 80, 443 |
| WEB | 8081 |
| WAS | 3001 |
| DB | 5432 |
| File sharing | 2049 |

Allow the required ports for public HTTPS and<br>
inter-server Tailscale traffic.

**Backups**

- Database: `pg_dump`
- Uploads: `storage/`
- Settings: runtime `.env`, Cloud credentials
- Certificates: `/var/lib/oanismajor/acme`

Preserve the certificate directory.<br>
Restoring `evidence` requires `storage/evidence.key`.

</details>

<details>
<summary>📁 Structure</summary>

| Path | Purpose |
| :---: | :---: |
| `was/` | Backend |
| `web/` | Frontend |
| `db/` | Database |
| `lib/` | Shared code |
| `storage/` | Stored files |
| `web/dist/` | Build output |
| `servers.json` | Defaults |
| `local.json` | Local overrides |
| `run.js` | Service runner |

`local.json` overrides the defaults.<br>
Runtime source: `/srv/oanismajor`. Nginx<br>
configuration: `/etc/oanismajor`.

Access runtime files from Windows at:

```text
\\wsl.localhost\Ubuntu\srv\oanismajor
```

</details>

</details>

---

### 📬 Contact

- **Email** [obabo0801@gmail.com](mailto:obabo0801@gmail.com)
- **Discord** `unjongjjing`
