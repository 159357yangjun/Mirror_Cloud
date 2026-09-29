# Changelog

## Unreleased - 2026-09-29ï¼æªåçï¼ä¸æ¹ versionãä¸æ tagï¼ç­ä½ æ¹åï¼

æ¬è½®æäº¤ï¼`a8eb977`ã`502b25c`ã`3c642af`ï¼åå¨ `dev`ï¼v1.4.4 ä¹åï¼ã

- **åå¸äº§ç©æ ¡éªå¨**ï¼`scripts/verify_release_assets.py`ï¼ï¼åä¸çç¨ä¸æ¬¡æ§çæ®µæ ¸å¯¹ï¼å¶ä¸­ä¸æ¬¡æ­£åæ²¡å¹éä¸å´æ¥äº"å·²éªè¯"ãç°å¨ä¸è·¯å¯¹è´¦ââæ¬æºéç®ãåå¸ç `SHA256SUMS.txt`ãGitHub API èªå¸¦ç `assets[].digest`ââå¹¶æ ¡éª tag çæ¬åºç°å¨æ¯ä¸ªæä»¶åä¸å½æ¡£å `Cargo.toml` / `package.json` / `tauri.conf.json`ï¼ä»¥å `source.zip` æ¯å¦æ°ç­äºè¯¥ tag çåçæ¬æ§å¶æ ï¼æ æå»ºäº§ç©ãæ å­æ®åæä»¶åã169 ä¸ªææ¬æä»¶æ 6 ç±»é«ä¿¡å·æ¨¡å¼æ«é¶å½ä¸­ï¼ã
- **å é¤åå¸é¾éæ²¡äººæ¶è´¹çææ¡£æå»º**ï¼`release.yml` ç `docs-bundle` ä½ä¸æå»º `website/dist` åä¸ä¼ ç artifact æ ä»»ä½ä½ä¸ä¸è½½ï¼å®å¯ä¸çé¢å¤æ£æ¥ï¼çæ¬ä¸è´æ§ï¼å¨ `windows-bundle` å·²è·ï¼ææ¡£ç«ç°ç± `docs.yml` æå»ºå¹¶åå¸ã`ci.yml` æ¯æ¬¡ push éå»ºã
- **ç ´åæ§æä½æ¹ç¨åºç¨åç¡®è®¤æ¡**ï¼åå 10 å¤ `window.confirm`ï¼å é¤èµæºãäºç«¯å é¤/ç§»å¨/æ¹åãæ¹éå é¤ãå¸è½½æä»¶ãæææéææãéç½® Local API Tokenãå é¤å­å¨ä¸å¤äºç»ï¼æ¯æµè§å¨å¤è§çåçæ¡ï¼ä¸å¨ WebView2 ä¸­ä¼æèµ·ç»å¶ç´å°è¢«å³é­ã`confirmAction` å¤±è´¥å³å³é­ï¼å³é­ãEscapeãç¹é®ç½©ãè¢«æ°è¯·æ±åä»£ä¸å¾ resolve(false)ï¼`ConfirmDialog` æªæè½½æ¶ promise æ°¸ä¸ resolveï¼å æ­¤é¸é¨åæåªä¼æ¡ä½æä½ãä¸ä¼æ¾è¡å é¤ã

### æ¬è½®éªè¯å½ä»¤ä¸å®éè¾åº

```text
$ for s in validate check_contracts check_user_flow check_workflow_action_pins \
      check_docs_site check_release_version check_tauri_dependency_family; do python scripts/$s.py; done
validate PASS  check_contracts PASS  check_user_flow PASS  check_workflow_action_pins PASS
check_docs_site PASS  check_release_version PASS  check_tauri_dependency_family PASS

$ python scripts/check_user_flow.py | tail -1
User-flow v1.3.5 task/observability/diagnostics hardening: OK | total checks: 143

$ python scripts/verify_release_assets.py --tag v1.4.4 --dir <ä¸è½½ç®å½> --api api_assets.json --repo .
Release asset verification OK | total checks: 35
      source archive is exactly the tracked tree of v1.4.4 (archive-only [], tree-only [])
      227 tracked files in the archive
      secret scan over 169 text files found nothing ([])

$ npm run build          # apps/desktopï¼tsc -b && vite build
â built in 1.13s
```

å®å«åäºåå¼éªè¯ï¼å¡åä¸ä¸ª `window.confirm` â FAIL `destructive gates use the in-app dialogâ¦`ï¼ææ `<ConfirmDialog />` â FAIL `the confirm dialog is mounted at the app root`ï¼å¨ release.yml ç¨ `npm install` â FAIL éæ¶è´¹æ­è¨ãä¸¤æ¡æ§æ­è¨åæ¬æ `window.confirm` å½ä½"å­å¨ç¡®è®¤æ­¥éª¤"çè¯æ®ï¼Gallery ç¡®è®¤å é¤ãæä»¶æææéï¼ï¼å·²æ¹ä¸ºè¦æ± `confirmAction`ï¼æä»¶é£æ¡é¢å¤è¦æ±"ç¨æ·æç»å³ return"ï¼å æ­¤ä¿è¯å¼ºäºæ¹åãå é¤ `docs-bundle` ä½¿æ§ç `npm ci >= 2` è®¡æ°æ­è¨å¤±æï¼å·²æ¿æ¢ä¸ºç´æ¥æ­è¨ä¸ä¸ªå·¥ä½æµé½ä¸åºç° `npm install` / `cargo generate-lockfile`ã

### æ¬è½®ä»ç¶æ²¡æéªè¯çä¸è¥¿

1. **æ°ç¡®è®¤æ¡çè§è§ä¸äº¤äº**ï¼ç¦ç¹åå§ä½ç½®ãEscape ä¸é®ç½©ç¹å»çå®éè¡ä¸ºãé¿ææ¡æ¢è¡ãä¸å¶ä»å¼¹å±ï¼ä¸ä¼ å¯¹è¯æ¡ / å¾åºé¢è§ï¼ç z-index å³ç³»ââåªè¿äº `tsc`ã`vite build` åéææ­è¨ï¼æ²¡æè¿è¡æ¶è§å¯ï¼ä¹æ²¡è£è¿åºç¨ã**ï¼å·²è¢«ä¸ä¸èçå®æµåä»£ï¼äºé¡¹å¨é¨éè¿ï¼å¶ä¸­é¿ææ¡æº¢åºæ¯çç¼ºé·å¹¶å·²ä¿®å¤ãï¼**
2. **æç¨åºåæ¯å¦ççè¿äº v1.4.3 / v1.4.4 çå**ï¼NSIS åç¼©ä½¿äºè¿å¶æç´¢æ æï¼è§£åæå®è£è¶åºææï¼åªæé´æ¥è¯æ®é¾ï¼Pages 10:47Z è¿å 200 â CI æ¢æµæ­¥ 11:01:46 â åç«¯æå»ºæ­¥ 11:10:26ï¼ã
3. **`openExternalUrl` å¤±è´¥æ¶ç¨æ·é¶æç¤º**ï¼ä¸å¤è°ç¨ç¹é½æ¯ `onClick={() => void openExternalUrl(...)}`ï¼`HelpCenterDialog.tsx:32`ã`StorageSetupDialog.tsx:256`ã`SettingsPage.tsx:328`ï¼ï¼rejection è¢«åï¼æ¬è½®åªè¯æäºè°ç¨ç¹å½¢æï¼æ²¡æé åº openUrl çå¤±è´¥çåºæ¯ãå¯ä¿®ï¼æªä¿®ã**ï¼å·²è¢«ä¸ä¸èåä»£ï¼ä¸¤ç§å¤±è´¥åºæ¯é½æé åºæ¥äºï¼å¹¶å·²ä¿®ãï¼**
4. **`3c642af` ç CI ç»è®º**ï¼æ¨éæåï¼ä»£çä¸åº¦å¨æ­ãç´è¿éè¯æåï¼ï¼ä½è®°å½æ¬æ¡æ¶ API ä¸å¯è¾¾ï¼å°æªè¯»å°è¯¥æ¬¡è¿è¡çæç»ç»æã**ï¼å·²å¡«å®ï¼`36592371911` / `36593715132` å `desktop-check completed / success`ï¼25 æ­¥æ ä¸éç»¿ãï¼**
5. **é»è®¤åæ¯ `main` æåå¦ä¸é¡¹ç®ï¼`# depot`ï¼**ï¼ææä»¤**æªæ§è¡ä»»ä½åæ¯æä½**ï¼åªäº¤æ¹æ¡ãå³é®äºå®æ¯ `git merge-base --is-ancestor origin/main HEAD` æç«ââmain æ¯ dev çç¥åï¼å æ­¤ `git push origin dev:main` æ¯**çº¯å¿«è¿ãé¶æäº¤ä¸¢å¤±ãä¸éè¦ force push**ï¼æ¨èå®èé"åªæ¹é»è®¤åæ¯æé"ï¼åèä»æ depot ç README çå¨ä»åºéï¼ãå½±åé¢ï¼Dependabot å·²æ¾å¼ `target-branch: dev` æä¸åå½±åï¼`release.yml` åªè®¤ `v*` tag ææ¨ main ä¸ä¼è¯¯åçï¼`ci.yml` æ åæ¯è¿æ»¤æä»¥åæ¨ main ä¼è· CIï¼å¤é¨å·²åäº«ç `blob/main/<èæä»¶>` é¾æ¥å¨æä»¶è¢«æ¹å/å é¤åä¼ 404ã

## Unreleased - 2026-09-29 ä¸åï¼åä¸è½®çç¬¬äºæ¹ï¼æ"æ æ³è¯æ"æ¹æ"å·²è¯æ"ï¼

æ¬è½®æäº¤ï¼`534cc15`ã`a561161`ï¼`dev`ï¼æ¥å¨ `a8eb977`ã`502b25c`ã`3c642af`ã`49f7e0c` ä¹åï¼ãä¸ä¸æ¹çä¸çç¬¬ 1ã3ã4 æ¡å¨æ¬æ¹è¢«å®æµåä»£ï¼åæä¿çå¨ä¸é¢å¹¶éæ¡æ æ³¨ç¶æã

### æµéææ®µ

åªèµ·åç«¯ï¼`npx vite --port 1420`ï¼**ä¸ç¢° Rustãä¸åºåãä¸è£ä»»ä½ä¸è¥¿**ï¼ãæµè§å¨ä¾§ç¨æ¬æºå·²è£ç Edge `--headless=new` + CDPï¼è¾å¥å¨é¨èµ° `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`ï¼å¯ä¿¡äºä»¶ï¼React ç `onMouseDown` æä¼ççè§¦åï¼ï¼éæ ·åå `getAnimations().pause()` å»ç»å¥åºå¨ç»ãå®æµè§å£ 1406Ã803ã

> ä¸­éè¸©å°ä¸ä¸ªä¼è®©ç»è®ºå¤±ççåï¼é½è®°ä¸æ¥ï¼â  ä¼è¯åç½®çæµè§å¨è¿æ¥å¨é£ä¸ªçªå£æ¯ 0Ã0 / `visibilityState: hidden`ï¼åä¸ä¸ª 440px å¡çè¢«éæ 186.8pxââéèçªå£çå ä½å¼ä¸å¯ç¨ï¼ç°å·²åæç¡¬é¨ç¦ï¼è§ä¸ï¼ï¼â¡ `styles.css` æ `scroll-behavior: smooth`ï¼`scrollIntoView()` ä¹åç«å»è¯» `getBoundingClientRect()` ä¼æ¿å°æ»å¨åçåæ ï¼ç¬¬ä¸æ¬¡è·å°±"ç¹ä¸å°"è®¾ç½®é¡µçæé®ï¼â¢ ç¨ bash heredoc ååº `.mjs` å `node` æ§è¡æ¶ï¼`'C:\\Program Files (x86)\\...\\msedge.exe'` çåææ è¢«åæï¼`spawn` æ¥ `ENOENT`ââ**è·¯å¾å¶å®æ¯å­å¨ç**ï¼åä¸è½® `ls` ååå°ï¼ãæ¢éèæ¬é Windows è·¯å¾ä¸å¾ç¨æ­£ææ ï¼`C:/Program Files (x86)/...`ï¼ï¼ä¸è¦å¨ bash éæ¼åææ ã

### éæ ·é¨ç¦ï¼æ¬èçæ°å¨é¨éåè¿ï¼

ä¸ä¸çè¿ä¸èéæä¸æ¡**ä½åº**çæ°ï¼è¿æ¥å¨é£ä¸ª Chrome çªå£æ¯ `visibilityState: hidden` + `inner/outer/screen = 0Ã0`ï¼åä¸ä¸ª `max-w-[440px]` å¡çå¨é£éè¢«éæ **186.796875px**ãé£æ¯ä¼ªå½±ï¼ä¸æ¯å¸å±ãè¿ä¸ªåçç¬¬ä¸ç§å½¢æï¼**ä¸æ¯å¨ç»ä¸­é´å¸§ï¼èæ¯çªå£éèæ¶æ´ä¸ªå¸å±åºåå°±è·³äº**ââèä¸éèçªå£ä¸ä¸å®æ¥ 0 å®½ï¼è§ä¸ï¼ã

ç°å¨æ¢éé `assertRealViewport(stage)` æ¯ç¡¬åç½®ï¼`visibilityState !== 'visible'`ã`innerWidth <= 0`ã`innerHeight <= 0`ã`clientWidth/Height <= 0` ä»»ä¸å½ä¸­å°±æééåºï¼ä¸æå¾ãä¸è®°æ°ï¼å®å¨æè½½åè°ç¨ä¸æ¬¡ï¼å¹¶å¨**æ¯ä¸æ¬¡å ä½éæ ·å**åè°ç¨ä¸æ¬¡ï¼åå§ç¦ç¹ã1440 é¿ææ¡ã420Ã720ã640Ã480ã640Ã480 æé«ãåå¸å±å­ãå¹³å±å½ä¸­æµè¯ãä¸ä¼ å¯¹è¯æ¡åä¸æ¬¡ï¼ï¼å ä½éæ ·å½æ°åé¨è¿åµäºä¸éåæ ·æ¡ä»¶çæ­è¨ã

é¨ç¦èªèº«æ¼ç¤ºè¿çº¢ï¼

```text
$ node scripts/verify_dialog_interactions.mjs gate        # exit 0
control                | expectedFail=false | passed=true  | visible 1406x803
window minimized       | expectedFail=true  | passed=false | VIEWPORT GATE FAILED: visibilityState=hidden
                         ä½åä¸æ¶å» innerWidth=1406 innerHeight=803 clientWidth=1406 hasFocus=false
window restored        | expectedFail=false | passed=true  | visible 1406x803
sawMinimizedReject: true   broken: []
```

**è¿æ¡æ¼ç¤ºæ¯é¢æ³çæ´å¼é±**ï¼çªå£æå°åæ¶ `innerWidth/innerHeight` ä»ç¶æ¯ 1406Ã803ï¼åªæ `visibilityState` ç¿»æ hiddenââä¹å°±æ¯è¯´"innerWidth>0 å°±å®å¨"æ¯éçï¼**load-bearing çé£ä¸é¡¹æ¯ visibility**ãè¯å®è®°å½æ²¡åå°çä¸¤ä»¶äºï¼`Emulation.setVisibilityStateOverride` å¨è¿ä¸ª Edge æå»ºéä¸å­å¨ï¼`setDeviceMetricsOverride` å¯¹ 0Ã0 éé»å¿½ç¥ï¼æä»¥ `innerWidth=0` é£ä¸æ¯å¨æ¬æº**æ²¡è½éæ°é åºæ¥**ï¼å®åªææ¬è½®æ©äºæ¶åè¿æ¥å¨é£æ¬¡ä¸æè¯»æ°ï¼hidden / inner [0,0] / client [0,0] / screen [0,0]ï¼ä½ä¸ºä¾æ®ã

### ä¿®å / ä¿®åéæ¡å¯¹ç§ï¼çè§å£ï¼13:00 ééï¼æ§æ°æ®ä½åºæ¸åè§æ¬èæ«ï¼

**`534cc15` é¿ææ¡æº¢åº**ââåä¸æ¬¡è¿è¡ãåä¸ä¸ªè§å£ï¼1406Ã803 / `visible`ï¼ãåä¸æ®µæ³¨å¥ææ¬ï¼64 ä½åå¸æä»¶å + ä¸æ¡ä¸æ­è¡ URLï¼ï¼åªæ `overflow-wrap` ä» `break-word` æ¹å `normal` æ¥å¤ç°ä¿®åç¶æãè¿æ ·ä¸¤è¾¹åªæè¢«æµå±æ§å¨åï¼æ¯"è·ä¸¤æ¬¡"æ´å¹²åï¼

| | `overflow-wrap` | `<p>` client / scroll | overflowX | å¡çå³è¾¹ç | æå­ç»å° | è¶åºå¡ç | å¡çé« |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ä¿®å | `normal` | 302 / **512** | **210px** | x=923 | **x=1068** | **+145px** | 284 |
| ä¿®å | `break-word` | 302 / 302 | **0** | x=923 | x=858ï¼åç¼© 65pxï¼ | **0** | 332 |

ç¨æ·è§è§ï¼ä¿®åé£è¡åå¸æä»¶å**ä»ç½è²å¡çéä¼¸åºå»ãåå¨æè²æ¨¡ç³èæ¯ä¸**ï¼æªå¾ `ab-before-break-words.png`ï¼èç¼ä¸ç¼å¯è§ï¼ï¼ä¿®åæ¶å¨å¡çåï¼ä»£ä»·æ¯å¡çå¤ä¸¤è¡é«ï¼284â332ï¼ã

**`a561161` ä¸å¤æç¨å¥å£**ââæ¯ç§åºåé½éå¯ dev serverï¼åªæ¹ç¯å¢åéï¼ä»åºéç½®æªå¨ï¼åèµ°çå®ç¹å»ï¼è®°å½å®éææ¬ï¼

| `VITE_DOCS_BASE_URL` | ä¸å¤æé® | ç¹å¼æ°æ ç­¾ | åºç¨åå®éæç¤ºï¼åæï¼ |
| --- | --- | --- | --- |
| æªè®¾ç½® | **ä¸å¤é½ä¸æ¸²æ**ï¼`getDocsBaseUrl()` è¿å nullï¼ | 0 | æ ãéç½®æç¨é¢æ¿ä»å¨ï¼ææ¡æ¯ãGitHub éç½®æç¨ / æç¨åç½®å¨åºç¨éï¼ä¸ä¾èµææ¡£ç½ç«ãæé¡ºåºå®æå³å¯ãã+ 5 æ­¥ |
| çäº§å¼ `https://159357yangjun.github.io/image-hosting-platform` | ãå¨çº¿ææ¡£ãÃ2ããå®æ´è°ç¨æç¨ä¸ç¶æç ã | 3ï¼æ é¢åå«æ¯ã5 åéä¸æ / æ¬æº HTTP API / è¿æ¥ GitHub \| å¾åº Â· Image Hosting Platformã | **æ åå¸**ï¼æ­£å¸¸è·¯å¾ä¸è¢«è¯¯æ¥ï¼è¿æ¡æ¯åå½é²çº¿ï¼ |
| ä¸å¯è¾¾ `https://definitely-not-a-real-docs-host.invalid/â¦` | åä¸ä¸å¤ç§å¸¸æ¸²æ | 3ï¼æ ç­¾æ é¢åªæè£¸åå `definitely-not-a-real-docs-host.invalid`ï¼= æµè§å¨èªå·±çéè¯¯é¡µï¼ | **æ åå¸** |
| ç¸å½¢ `not a url` | ä¸å¤ç§å¸¸æ¸²æï¼æé®ä¸æ ¡éªå¼ï¼ | 0 | ä¸å¤åä¸æ¡ï¼**ãæå¼é¾æ¥å¤±è´¥ï¼TypeError: Failed to construct 'URL': Invalid URLã** |
| é http `ftp://docs.example.invalid/base` | ä¸å¤ç§å¸¸æ¸²æ | 0 | ä¸å¤åä¸æ¡ï¼**ãæå¼é¾æ¥å¤±è´¥ï¼Error: åªåè®¸æå¼ http/https å¤é¨å°åã** |

**è½ä¸è½åºå"ç½ç»ä¸å¯è¾¾"ä¸"åè®®è¢«ç­ç¥æ¦ä¸"ï¼è½ï¼ä½ä¸å¯¹ç§°ã** åè®®è¢«æ¦ / URL ç¸å½¢ â ä¸å¼æ ç­¾ + æç¡®åå¸ï¼ç½ç»ä¸å¯è¾¾ â **å¼æ ç­¾ä¸æ²¡æä»»ä½åºç¨åæç¤º**ï¼ä¸"æå¼æå"å¨ UI ä¸å®å¨åå½¢ãè¿ä¸æ¯ææ¼ä¿®ï¼`window.open` åªåè¯ä½ ææ²¡ææçªå£äº¤åºå»ï¼é¡µé¢å è½½ç»æå±äºå¦ä¸ä¸ªæµè§è¿ç¨ï¼`noopener` ä¹ä¸æ´æ¿ä¸å°å¥æã**æä»¥è¿æ¡ä¿®å¤è¦ççæ¯"æä»¬èªå·±ç¥éå¤±è´¥"çé£ä¸¤ç±»ï¼ä¸è¦ç"è¿ç«¯æäº"ã** è¿ç«¯ä¸å¯è¾¾ç®åå¯ä¸çç¼è§£æ¯é£å¥ãæç¨åç½®å¨åºç¨éï¼ä¸ä¾èµææ¡£ç½ç«ãââ5 æ­¥åç½®æç¨ä¸å¨çº¿æç¨æ¯ä¸¤æ¡ç¬ç«ä¾ç»ã

**æ¬èä½åºçæ§æ°æ®**ï¼æ¥èªä¼è¯åç½®è¿æ¥å¨é£ä¸ª `visibilityState: hidden` + `inner/outer/screen = 0Ã0` ççªå£ï¼åªæ­¤ä¸æ¡å ä½å¼ï¼å¶ä½å±æ§è¯»æ°æ¯ææçï¼ï¼

- `dlgWidth: 186.796875` ââ **ä½åº**ï¼0Ã0 è§å£ä¸ `max-w-[440px]` çä¼ªå½±ï¼åä¸æ¬¡è¯»æ°éç `dialogRect: {}`ï¼å¨ 0ï¼ä¸å¹¶ä½åºã
- åä¸æ¬¡è¯»æ°éç `overlayZ: "95"`ã`overlayPosition: "fixed"`ã`sectionMaxWidth: "440px"`ã`pWhiteSpace: "pre-line"`ã`activeElementText: "åæ¶"`ã`focusIsCancel: true` æ¯**å±æ§/ææ¬**è¯»æ°ï¼ä¸ä¾èµè§å£ï¼ä¿çï¼ä¸è¿äºéåæ¥é½å¨é¨ç¦ä¸éåè¿ä¸éï¼è§ä¸è¡¨ä¸ `report-confirm.json`ï¼ã
- æ¬è½®æ¥åé**æ²¡æä»»ä½ä¸ä¸ªæ°å­**åèª hidden çªå£ï¼`210 / 145 / 302 / 512 / 440 / 332 / 284 / 952 / 95 / 70 / 50 / 80 / 90 / 472` å¨é¨æ¥èªé¨ç¦æ¾è¡åç headless Edgeï¼`visible`ï¼1406Ã803ï¼ææ¾å¼ `setDeviceMetricsOverride` ç 420Ã720 / 640Ã480ï¼ã



### ç¡®è®¤æ¡ï¼äºä»¶äºçå®æµå¼ï¼åç¬¬ 1 æ¡ï¼ä»"æ æ³è¯æ"ç§»åºï¼æ¯ä¸é¡¹é½å¨çè§å£ä¸åæ°ï¼

| é®ç | å®æµï¼è§å£ 1406Ã803ï¼`visible`ï¼ |
| --- | --- |
| åå§ç¦ç¹ | `document.activeElement.textContent === 'åæ¶'`ï¼`focusIsCancel: true`ã`focusIsConfirm: false`ãè¿½å æµäº Enterï¼ç¦ç¹å¨åæ¶ä¸æ¶åè½¦**å³é­ä¸ä¸æ§è¡**ç ´åæ§å¨ä½ã |
| Escape | å³é­ãå³é­åè®¾ç½®é¡µæ²¡æåºç°"æä½ç»§ç»­æ§è¡"æä¼äº§ççéè¯¯åï¼é¡µé¢éè¯¯æ¥å¿ä¸ºç©º â è¯´æ resolve(false) èµ°éã`await` åé¢çåæ¯æ²¡è·ã |
| ç¹é®ç½© | å¨ (8,8) æä¸å³å³é­ï¼`onMouseDown`ï¼ä¸æ¯ `onClick`ï¼ï¼å¨å¡çæ é¢ä¸æä¸**ä¸**å³é­ï¼`stopPropagation` çæï¼ï¼å³ä¸è§ X å³é­ã |
| é¿ææ¡ | å¡çå®½åº¦æ 440px ä¸å¢é¿ã**ä¿®å¤å**ï¼`<p>` å¯è§å®½ 302pxã`scrollWidth 550` â overflowX **248px**ï¼æå­ç»å°é®ç½©ä¸æ¨¡ç³èæ¯ä¸ï¼è§å£ 1406Ã803 ä¸ 640Ã480 åä¸ä»½ï¼åææªå¾ï¼ã**ä¿®å¤å**ï¼æ é¢ä¸æ­£æå  `break-words`ï¼ï¼1440 / 420Ã720 / 640Ã480 ä¸ç§è§å£ä¸ overflowX å¨é¨ **0**ã |
| z-index | ç¡®è®¤å± computed `z-index: 95`ã`position: fixed`ï¼ç¥åé¾åªæå®èªå·±å  `backdrop-filter` çæå±å ä¸ä¸æï¼`main` ä¸ `app-shell-root` é½æ¯ `static`/`z-auto` â ä¸å¶ä»å¼¹å±å¨åä¸æ ¹ä¸ä¸æç´æ¥æ¯å¤§å°ï¼UploadDialog `50`ãStorageBrowser å± `70`ãå¶é¢è§ `80`ãHelpCenter / ThemePanel / å¾åºé¢è§ `90`ãToastViewport `70`ã**çå®å±å­å½ä¸­æµè¯**ï¼éè·å°æåä¸ºæ­¢ï¼ï¼ç¡®è®¤æ¡å¼ççåæ¶è®©æä»¶/ä»»å¡è·¯ç±åæ 4 æ¡åå¸ï¼`elementFromPoint(åå¸ä¸­å¿)` è½å¨ç¡®è®¤å±åï¼`isToastOrChild:false, isConfirmOrChild:true`ï¼â 95 çä½ 70ãConfirmDialog æ¯ `main` çæåä¸ä¸ªå­èç¹ï¼æåå¸æ¶ index 2 of 3ï¼æ åå¸æ¶ 1 of 2ï¼ãUploadDialog ä¸ç¡®è®¤æ¡æ æ³çå±å­ï¼å®çé®ç½©åæä¾§æ ç¹å»ï¼ï¼"å¹³å±"æ¹ç¨å class ç `fixed inset-0 z-[95]` åæèç¹æµï¼**åæè½½èå½ä¸­**ï¼`hitIsSynth:true`ã`confirmOrderVsSynth:-1`ï¼â `GalleryPage.tsx:364` é£ä¸ªåä¸º 95 çè·¯å¾å¯¹è¯æ¡è¾ç» `App.tsx:53` æåæè½½ç ConfirmDialogï¼å¾åºé¢è§ 90 < 95 æå¨ä¸æ¹ã |

çªè§å£çä¸¤æ¡è¦åæ¸å¯è¾¾æ§ï¼**420Ã720 ä½äº `tauri.conf.json` ç `minWidth: 640`**ï¼é£éå¡ç 440 + å·¦å³ 16 åè¾¹è· = 472 > 420ï¼ç¡®è®¤æé® `confirmFullyVisible: false` è¢«è£åºè§å£ââ**äº§åéå°ä¸äºè¿ä¸ªå®½åº¦**ï¼åªä½ä¸º CSS å¥çº¦è®°å½ï¼640Ã480ï¼çå®ä¸éï¼ä¸åä¸ä»½é¿ææ¡ overflowX 0ãå¡ç 440Ã472ãæé®å®æ´å¯è§ã



çº¯æµè§å¨ä¸å´©ï¼7 æ¡è·¯ç±éä¸ªå¯ä¿¡ç¹å»å `main h1` é½æ­£ç¡®åæ¢ã`#root` æªå¸è½½ãæ  React å´©æºï¼ç¼º Tauri è¿è¡æ¶çè¡¨ç°æ¯åå¸ãæ°æ®å è½½å¤±è´¥ï¼TypeError: Cannot read properties of undefined (reading 'invoke')ãã**è¿æ¡åªå¨é Tauri è¿è¡æ¶åºç°ï¼è£åç¨æ·çä¸å°ï¼å æ­¤æ harness äºå®è®°å½ãä¸ç®äº§åç¼ºé·ã**

### ä¸å¤è°ç¨ç¹ä¸ä¸¤æ¡è¸©åè®°å½

ä¸å¤ `void` è°ç¨ç¹çç¡®åä½ç½®ï¼`HelpCenterDialog.tsx:32`ï¼ç» `AppShell.tsx:114` æ³¨å¥ï¼ã`SettingsPage.tsx:328`ã`StorageSetupDialog.tsx:256`ï¼åèè¦åå¨äºç«¯é¡µå±å¼"éç½®æç¨"é¢æ¿æåºç°ï¼ï¼åä¸æ¹éå¦å¤ 6 å¤æ¯ `GalleryPage.tsx:321/342/388` ä¸ `StorageBrowserDialog.tsx:149/169/183` ç"æµè§å¨æå¼"ï¼å®ä»¬å±ç¨åä¸ä¸ªåè£å½æ°ãéåºåçå®éæç¤ºææ¬è§ä¸é¢é£å¼ è¡¨ã

- æç¬¬ä¸çé¡ºæå ç `if (!window.open(...)) throw new Error('æµè§å¨æ¦æªäºæ°çªå£â¦')` **æ¯éç**ï¼è§èè§å®å¸¦ `noopener` æ¶ `window.open` ä¸å¾è¿å `null`ï¼å®æµä¸ä¸ªæ¬æ¥è½æ­£å¸¸æå¼çé¾æ¥å¨é¨è¯¯æ¥æ"è¢«æ¦æª"ï¼é£ä¸æ¬¡çåå¸åæï¼ãæå¼é¾æ¥å¤±è´¥ï¼Error: æµè§å¨æ¦æªäºæ°çªå£ï¼è¯·åè®¸å¼¹åºçªå£åéè¯ãï¼åºç°å¨ææå·²ç»å¼å¥½çæ ç­¾æè¾¹ï¼ãå·²æ¤æï¼å¹¶å¨æ³¨ééåææµè§å¨åæ¯åªè½æ¥åçæ­£ç rejectionã
- ä¸¢å¼ promise è¿ä»¶äºæ¬èº«ççº¢âç»¿æ¯å¨åä¸é¡µé¢éå¯¹ç§æµçï¼ç­åå¸æ æ¸ç©ºååè°ä¸æ¬¡ï¼ï¼`void openExternalUrl('not a urlâ¦')` â `toastsAfterVoidCall: 0`ï¼åªçä¸æ¡ `Uncaught (in promise)` çé¡µé¢éè¯¯ï¼`openExternalUrlOrReport(åä¸ä¸ªå¼)` â `toastsAfterWrapperCall: 1`ï¼ææ¬å°±æ¯è¡¨éé£æ¡ TypeErrorã
- è¯å®è¾¹çï¼`popup è¢«æ¦`è¿ä¸ç§å¤±è´¥å¨æµè§å¨åæ¯ä»**ä¸å¯æ£æµ**ï¼ä¿ç `noopener` æ¯ä¸ä¸ªè¯æ­ä¿¡å·æ´å¼é±ï¼ï¼Tauri åæ¯ç `openUrl` rejection ç°å¨ä¼è¢«æ¥åï¼ä½é£æ¡åæ¯éè¦ Rust è¿è¡æ¶ï¼æ¬æºæ²¡è·ã

### æµå·å·²è¿ä»ï¼`scripts/verify_dialog_interactions.mjs`

ä¸é¢æææ°å­é½åºèªè¿ä¸ªæ¢éãå®æ­¤ååªå­å¨äºä¼è¯ç®å½ï¼`cdp-dialog-probe.mjs`ï¼34,750 å­è / 12:31ï¼ï¼èä»åºéå·²ç»æ 11 ä¸ª `scripts/*` æ£æ¥å¨ââ**ä¿®æåºæ¥äºï¼å«äººéè·ä¸äºéªè¯ï¼ä¼è¯ç®å½ä¸æ¸æµå·å°±æ²¡äº**ãç°å¨å®ãå®çå¥å£ãä»¥å"è®¤è¯å®çæ£æ¥å¨"çæçº¹é½å¨ä»éã

**æçº¹ï¼æ¹å¨è¿ä¸¤ä¸ªæä»¶åå¿é¡»åæ¥æ´æ°è¿éï¼å¯¹ä¸ä¸å°±è¯´ææµå·ä¸ç»è®ºä¸æ¯åä¸ä»½ï¼**

| æä»¶ | è¡æ° | å­è | sha256 | åºçº¿éè¿é¡¹æ° |
| --- | --- | --- | --- | --- |
| `scripts/verify_dialog_interactions.mjs` | 888 | 55,706 | `c1d7a403b69a3b3388cb75c47cbbd078ec2899a51eff11f6c349da8946c9797d` | `gate-unit` 6/6ã`gate` 3 é¡¹ + `sawMinimizedReject: true`ã`ab` `deltaOverflowX: 210` |
| `scripts/check_user_flow.py`ï¼è®¤è¯ä¸é¢è¿ä¸ªæµå·çé£ä»½æ£æ¥å¨ï¼ååå¨ `scripts/`ï¼ | 399 | 37,698 | `68ca52df99683acd005b3c1b235fd6d13c64dbd24483a91803d50800ff2bc70d` | `total checks: 155` |

- **ä¾èµï¼é¶ç¬¬ä¸æ¹åã** åªç¨ `node:child_process` + `node:fs`ï¼å ä¸ Node 22+ èªå¸¦çå¨å± `fetch` / `WebSocket`ã`check_user_flow.py` ä¼è§£æå®ç import åè¡¨ï¼åºç°ä»»ä½é `node:` åç¼å°± FAILã
- **å¥å£**ï¼`cd apps/desktop && npm run verify:dialog <mode>`ï¼`verify:dialog` å°±æ¯ `node ../../scripts/verify_dialog_interactions.mjs`ï¼ãæ¨¡å¼ `confirm | ab | gate | gate-unit | links | pages | external`ï¼`--help` æå°åä¸ä»½è¯´æãè¿æ¡æ¥çº¿ä¹è¢«æ­è¨éä½ï¼`the harness is reachable from an npm script entry`ã
- **ä¸ºä»ä¹æ¹äº `apps/desktop/package.json`ï¼ä¸æ¯ä¾èµä¾å¤ç»è®°ï¼**ï¼ä»åºé**æ²¡ææ ¹ `package.json`**ï¼`git ls-files package.json` è¿å 0 ä¸ªï¼ï¼æä»¥"æ¥è¿æ ¹ package.json"è¿ä¸ªæºå¶ä¸å­å¨ï¼å¨ä¸ä¸ª Rust workspace æ ¹ä¸æ°å»ºä¸ä¸ªæ²¡æ lock ç npm æ¸åï¼æ­£å¥½åè¿ä¸ªä»åº"åªä»å·²æäº¤ç lock å®è£"ççºªå¾ç¸åï¼æä»¥å¥å£æå¨**å·²æ**ç `apps/desktop/package.json` ä¸ï¼ä¸**åªå äºä¸ä¸ª `scripts` é®**ââ`name` / `private` / `version` / `type` / `dependencies` / `devDependencies` ä¸å­æªå¨ï¼`package-lock.json` æªæ¹ï¼æªè·è¿ `npm install`ãä»åºéæ¬æ¥å°±æ²¡æ"éç½®ä¾å¤ç»è®°"è¿ç±»æä»¶ï¼è¿å¥è¯å æ­¤åå¨è¿éèä¸æ¯å«å¤ã
- **è¾åºä½ç½®**ï¼æªå¾ä¸ JSON é»è®¤è½ `%TEMP%/image-hosting-probes/<æ¥æ>/`ââä¸åè¿ä»åºï¼ä¹ä¸åä¸»ç®å½æ ¹ï¼dev server æ²¡èµ·å°±ç´æ¥ `rc=4` å¹¶æå°è¯¥æ²çé£æ¡å½ä»¤ï¼æµè§å¨è·¯å¾èªå¨æ¢æµ Edge(x86)âEdgeâChromeï¼`--edge` å¯è¦çã
- **ä»ä»åè·¯å¾å¤è·ï¼ä¸ä¼è¯ç®å½çéä½ç¸åï¼**ï¼`gate` â `rc=0`ã`sawMinimizedReject: true`ï¼`ab` â `210 / 145 / 302 / 512 / 923 / 1068 / 858 / 332 / 284`ï¼`confirm` â ç¦ç¹ `åæ¶`ãEscape/é®ç½©/X/Enter å¨å³ãå¡çåæä¸ä¸å³ãoverflowX å¨ 1440 / 420Ã720 / 640Ã480 ä¸ç§è§å£åä¸º 0ãz å±çº§ 95 > 70 > 50ã

### é¨ç¦æ¦ä¸è¿ä»ä¹ï¼ä¸æ¯èªè¿°ï¼æ¯è¢«åå¼é¼åºæ¥çï¼

`gate-unit` æé¨ç¦å¤å®æ½æçº¯å½æ°ååç¬åè¯»æ°ï¼**æ¯ä¸ªæç»ç¨ä¾åªç ´åä¸ä¸ªæ¡ä»¶å¹¶æåè¦ååªä¸å­å¥**ï¼

```text
$ npm run --silent verify:dialog gate-unit          rc=0
OK   live headless viewport                -> accepted
OK   hidden, sizes healthy                 -> rejected: visibilityState=hidden (needs "visible")
OK   innerWidth 0, everything else healthy  -> rejected: innerWidth=0 (needs > 0)
OK   innerHeight 0, everything else healthy -> rejected: innerHeight=0 (needs > 0)
OK   clientWidth 0, everything else healthy -> rejected: client=0x803
OK   recorded connector reading (hidden + 0x0) -> rejected: åæ¡å¨ä¸­
Viewport gate unit check: 6/6 correct
```

**è¿éååºè¿ä¸æ¬¡åç»¿ç¯ï¼æ¯åå¼è¯åºæ¥ç**ï¼ç¬¬ä¸çç¨ä¾æ `innerWidth` å `clientWidth` ä¸èµ·è®¾æ 0ï¼äºæ¯**å æ `innerWidth` é£ä¸æ´æ¡å­å¥åä»ç¶ 6/5â5/6 å¨è¿**ï¼`client=0xâ¦` æ¿å®æé¡µé¢ä¸å»äºï¼ãæ¹æ"æ¯ä¾åªåä¸é¡¹ + å¿é¡»æåè¿å"ä¹åï¼äºæ¡åå¼åèªåçº¢ï¼

```text
M1 å  innerWidth å­å¥   â rc=1  FAIL innerWidth 0, everything else healthy -> accepted      (5/6)
M2 å  visibility å­å¥   â rc=1  FAIL hidden, sizes healthy -> accepted; FAIL recorded â¦     (4/6)
M3 å  innerHeight å­å¥  â rc=1  FAIL innerHeight 0, everything else healthy -> accepted     (5/6)
M4 å  client å­å¥       â rc=1  FAIL clientWidth 0, everything else healthy -> accepted     (5/6)
M5 å¤å®æè¿             â rc=1  FAIL äºæ¡å¨è¢« accepted                                      (1/6)
M6 ææ npm å¥å£        â rc=1  FAIL the harness is reachable from an npm script entry
æ¯æ¬¡æ¹å®ç«å³è¿åå¹¶ diff -q ç¡®è®¤å­èä¸è´ï¼baseline ä¸ restored å rc=0ã
```

çæµè§å¨ä¾§çç«¯å°ç«¯æ¦æªï¼`gate` æ¨¡å¼ï¼`Browser.setWindowBounds minimized`ï¼ï¼`visibilityState` ç¿»æ `hidden` è `innerWidth/innerHeight` **ä»æ¯ 1406Ã803**ï¼é¨ç¦ç§æ ·æééåºââæä»¥"å°ºå¯¸>0 å°±å®å¨"æ¯éçã`innerWidth=0` é£ä¸æ¯**æ¬æºæ æ³å¨æ´»é¡µé¢ä¸å¤ç°**ï¼`setDeviceMetricsOverride` å¿½ç¥ 0ï¼æå°åçªå£ä¿çæ§å°ºå¯¸ï¼ï¼å®ç±ä¸é¢ `gate-unit` çç¬¬ 3ã6 ä¾è¦çï¼è¾å¥æ¯æ¬è½®è¿æ¥å¨å®éæ¥è¿çè¯»æ°ã**è¿æ¯ç­ä»·ç©çè¾¹çï¼å«å½ç«¯å°ç«¯è¯æ®ã**

å®å«è®¡æ°ï¼`check_user_flow.py` 143 â 150 â 154 â **155**ï¼æ¬æ¹ +1 æ¡å¥å£å¯è¾¾æ§ï¼ã


### æ¬è½®è®°å½ï¼ä»åºè·¯å¾ä¸å®ç¶æï¼

- ä»åºè·¯å¾ï¼ç»å¯¹ï¼ï¼`D:image-hosting-platform`ï¼åæ¯ `dev`ï¼è¿ç«¯ `origin/dev`ã
- **æäº¤å** `git status -sb` éå­è¾åºï¼æ¬æä»¶å³å¶ä¸­ä¹ä¸ï¼æä»¥å®å¿ç¶å¨åè¡¨éï¼ï¼

```text
## dev...origin/dev [ahead 3]
 M CHANGELOG.md
 M apps/desktop/package.json
 M scripts/check_user_flow.py
 M scripts/verify_dialog_interactions.mjs
```

  æ¬æ¹ä¸¤ç¬æäº¤ä¹ååºä¸º `## dev...origin/dev [ahead 5]` ä¸å·¥ä½åºæ è¾åºã`[ahead 3]` æ¯ `8f8d1e3`ã`f387a66`ã`0bb8dfe` ä¸ç¬æªæ¨æäº¤ââ**æ¬è½®æä»¤æ¯ä¸ push**ï¼æä»¥è¿ç«¯ä»åå¨ `fe57911`ï¼æ¨éç¶æä»¥ `git status -sb` ä¸ºåï¼ä¸ä»¥æ¬æä»¶ä¸ºåã
- å®æ´é¾è·¯å®è¾åºï¼`cd apps/desktop && npx vite --port 1420` èµ·åç«¯åéæ¡è·ï¼åçå®éåºç ï¼ï¼

```text
validate                          rc=0 | ... version alignment: 1.4.4 | GitHub write queue: OK
check_contracts                   rc=0 | frontend invokes: 66 | Rust commands: 66 | registered: 66
check_user_flow                   rc=0 | total checks: 155
check_docs_site                   rc=0 | total checks: 16
check_workflow_action_pins        rc=0 | GitHub Actions pin validation passed for 19 external action reference(s).
check_release_version             rc=0 | Release version consistent: 1.4.4
check_tauri_dependency_family     rc=0 | Locked family: tauri=2.11.5, tauri-runtime=2.11.3, tauri-runtime-wry=2.11.4
npm run verify:dialog gate-unit   rc=0 | Viewport gate unit check: 6/6 correct
npm run verify:dialog gate        rc=0 | "sawMinimizedReject": true
npm run verify:dialog ab          rc=0 | "deltaOverflowX": 210
npm run verify:dialog confirm     rc=0 | äºé¡¹éæ ·å¨é¨å¨é¨ç¦ä¸åå¾
```

### æ¬è½®éªè¯å½ä»¤ä¸å®éè¾åº

```text
$ for g in validate check_contracts check_user_flow check_docs_site; do python scripts/$g.py; done
validate           ... version alignment: 1.4.4 | GitHub write queue: OK
check_contracts    Command contracts: OK | frontend invokes: 66 | Rust commands: 66 | registered: 66
check_user_flow    User-flow ... OK | total checks: 150        # 143 â 150ï¼æ¬æ¹ +7
check_docs_site    Docs site contract OK | total checks: 16

$ cd apps/desktop && npx tsc --noEmit -p tsconfig.app.json
ï¼æ è¾åºï¼exit 0ï¼

$ python jobs.py 36592371911 36593715132      # GitHub Actions API
=== run 36592371911 ===   desktop-check | completed | success | steps=25 | non-green=[]
=== run 36593715132 ===   desktop-check | completed | success | steps=25 | non-green=[]

$ python watch_ci.py                          # æ¬æ¹ä¸ä¸ªæäº¤æ¨ä¸ dev ä¹å
attempt 3: run 36599075215 CI status=completed conclusion=success
JOB desktop-check | completed | success | steps=25 | non-green=[]

$ python watch_ci.py                          # è®°å½æäº¤ 86e59a3 ä¹å
attempt 4: run 36599811212 CI status=completed conclusion=success
JOB desktop-check | completed | success | steps=25 | non-green=[]

$ python watch_ci.py                          # ä½åº 186.8 å¹¶ééä¹å fe57911
attempt 3: run 36600841593 CI status=completed conclusion=success
JOB desktop-check | completed | success | steps=25 | non-green=[]
```

åç¬¬ 4 æ¡ï¼`3c642af` / `49f7e0c` ç CI ç»è®ºï¼å°æ­¤å¡«å®ï¼ä¸¤æ¡æäº¤åè§¦åä¸æ¬¡ CIï¼è¿è¡ `36592371911` ä¸ `36593715132`ï¼å¯ä¸ä½ä¸ `desktop-check` å `completed / success`ï¼25 ä¸ªæ­¥éª¤æ ä¸éç»¿ã

å®å«åå¼éªè¯ï¼æ¯æ¬¡åªæ¹ä¸å¤ï¼è·å®ç«å³è¿åå¹¶å¤æ ¸åå®¹ä¸è´ï¼ï¼ææ `<p>` ç `break-words` â FAIL `the confirm dialog detail wraps unbreakable filenames`ï¼æ `SettingsPage.tsx:328` æ¹åä¸¢å¼ promise çåæ³ â FAIL `no external-link open is fire-and-forget (['src/pages/SettingsPage.tsx'])`ï¼ææåè£éç `.catch(...)` â åæ¶ FAIL ä¸é¢ä¸¤æ¡ãè¿æ¡å®å«èªå·±ä¹çº¢è¿ä¸æ¬¡ï¼å®æ `desktop.ts` éæè¿°æ§åæ³ç**æ³¨éææ¬**å½æäºè¿è§è°ç¨ç¹ï¼ææ²¡ææ¾å®½æ­è¨ï¼èæ¯æ¹åæ³¨éââæ¾å®½è§åä¼è®©ä¸ä¸ä¸ªçè°ç¨ç¹æ··è¿å»ã

### æ¬æ¹ä»ç¶æ²¡æéªè¯çä¸è¥¿

1. **åºåå°åºè¿æ²¡è¿ v1.4.3 / v1.4.4 çå**ï¼ææ¹åä¸ä¸åãä¸è§£åãä¸å®è£ï¼è¿æ¡**åè®¸é¿æåå¨æ æ³æ¬å°è¯æ**ãæ¥åè¦è¯çè¯ï¼æ¹æ¡æ¯å¨ `release.yml` ç°æ `windows-bundle` ä½ä¸éå ä¸æ­¥ `echo "docs base baked as: ${env:VITE_DOCS_BASE_URL}"`ââä¸æ°å¢ä½ä¸ãä¸æ°å¢ artifactãä¸æ¹ versionãä¸å¨ `check_docs_site.py` é"ç¦æ­¢ç¡¬ç¼ç  `VITE_DOCS_BASE_URL:`"çæ¢æçº¦æï¼å®ç¦çæ¯ç¡¬ç¼ç ï¼åæ¾æ¢æµç»ææ¯å¦ä¸åäºï¼ã**æ¹æ¡åæ¥ï¼æªæ¹ä¸å¨ CIã**
2. **Tauri åæ¯ç `openUrl` å¤±è´¥æç¤º**ï¼éè¦ Rust è¿è¡æ¶ï¼æ¬æºæ  cargoï¼åªè½é ä»£ç è·¯å¾æ¨æ­ã
3. **14 è¡çº§é¿ææ¡å¨æå°çªå£ä¸çå¯ç¨æ§**ï¼640Ã480ï¼`tauri.conf.json` ç minWidth/minHeightï¼æ¶ï¼æ¬è½®é£ä¸² 5 è¡é¿ææ¡ä¸å¡ç 440Ã472ãæé® `confirmFullyVisible: true`ï¼ææ­£ææå° 14 è¡åå¡çé« **952px**ãç¡®è®¤æé® `confirmFullyVisible: false`ï¼ä¸é®ç½© `overflowY: visible` ä¸å¯æ»å¨ â ç¨æ·æ¢çä¸å°ä¹ç¹ä¸å°ã**å½å 10 ä¸ªè°ç¨ç¹éæé¿çæ¹éå é¤ææ¡åªæ 2 è¡ï¼æé ä¸åºè¿ä¸ªå°ºå¯¸ï¼æä»¥å¤æ½å¨èéç°å­ç¼ºé·ï¼æªä¿®ã** çè¦ä¿®æ¯ç» `<section>` å  `max-h` + æ»å¨ã
4. **ç¡®è®¤æ¡æå¼æé´åå¸è¢«é®ä½**ï¼95 çä½ 70 å·²å®æµï¼`elementFromPoint` è½å¨ç¡®è®¤å±åï¼ï¼ä¸é®ç½©æ¬èº«æ¯ `background-color: oklab(0.129 â¦ / 0.35)` + `backdrop-filter: blur(8px)`ââåå¸æ¯ç»å¨è¿å± 35% æè² + 8px æ¨¡ç³**ä¹ä¸**çï¼æªå¾ `10-toast-behind-confirm.png`ã"è¿è½ä¸è½è¯»æ¸"æ¯æç¥å¤æ­ï¼ææ²¡æä¸ç»è®ºï¼è½ç¡®å®çæ¯å®ä¸å¨æä¸å±ãç¹ä¸å°ï¼åå¸å®¹å¨ `pointer-events: none`ï¼å¶ä¸çç¡®è®¤å±åæå½ä¸­ï¼ãç°æ 10 ä¸ªè°ç¨ç¹é½æ¯"ç¡®è®¤å³é­ä¹åæååå¸"ï¼æä»¥çå®æµç¨éè¿æ²¡æé åº"ç¡®è®¤æ¡è¿å¼çãåå°åæ¥é"çåºæ¯ã
5. **`StorageBrowserDialog.tsx:148 / :168 / :182` è¿æ 3 å¤ `void copyText(...)`**ï¼ä¸ä¸ª"å¤å¶"æé®ï¼ï¼åè¿è½®ä¿®æç `void openExternalUrl` æ¯åä¸ç±»ä¸¢å¼ promise çåæ³ï¼åªè´´æ¿åå¥å¤±è´¥æ¶æé®ä¸ä¼ç»ä»»ä½åé¦ãåä¸æ¡çº¿æ¹èµ·æ¥åªè¦æåè£å½æ°æ¢æéç¨çï¼ä½æ¬è½®æ²¡æå®æµè¯æ®ï¼æµè§å¨åæ¯ç `navigator.clipboard` å¨ headless ä¸ç´æ¥æåï¼æé ä¸åºå¤±è´¥ï¼ï¼æä»¥**åªç»è®°ä¸å¨**ï¼ç­çéè¦æ¶ä¸èµ·æ¹ã
6. **é»è®¤åæ¯ `main` æåå¦ä¸é¡¹ç®**ï¼ä¾æ§åªäº¤æ¹æ¡ãæªæ§è¡ä»»ä½åæ¯æä½ï¼æ¹æ¡ä¸å½±åé¢è§ä¸ä¸æ¹ç¬¬ 5 æ¡ã

## 1.4.4 - Gallery Render Bound and Installer Publisher


- Bound gallery rendering: past 600 revealed entries the page reports how many remain and asks you to narrow the directory or search instead of offering another batch forever. The cap is soft, so up to about 720 files stay fully reachable with no limit message. This also bounds what å¨éæ¬é¡µæä»¶ can select, which previously could reach every entry you had revealed.
- Name the installer publisher. `bundle.publisher` was unset, so WiX fell back to the second segment of the identifier and the MSI reported `Manufacturer = multicloud`; publisher and copyright now carry the string from `LICENSE`. This affects Windows Installer metadata only - the `.exe` `CompanyName` version resource has no Tauri configuration key and stays empty.

## 1.4.3 - Online Tutorials Reachable

- The tutorial site is published at `https://159357yangjun.github.io/image-hosting-platform`, so this is the first bundle whose **å¨çº¿ææ¡£ / éç½®æç¨ / æ¬æº API æç¨** entries resolve: release.yml probes one real tutorial route before building and bakes the base URL only when it answers 200.
- Document how API and Typora publishes differ from a desktop publish: they persist a `typora_publish` task but cannot raise `task://updated` or `asset://published`, so the open window refreshes by polling and auto-copy after publish does not happen.
- Give the exact Raw URL the app builds for Gitee when no custom domain is set.

## 1.4.2 - Error Channel and Cloud Onboarding Truthfulness

- Stop reporting one plugin failure twice. Those mutations declare no `onError`, so the global handler already raises a toast; the inline `window.alert` was a second report for the same event, and in WebView2 an alert suspends painting until it is dismissed. Storage pages that did own their error path now use the same toast channel instead of a native dialog, and batch enable/disable reports that the remaining plugins were left untouched rather than dumping a raw error string.
- State when the object-storage / WebDAV **public access domain** actually matters. Nothing derives an image URL from an Endpoint, so leaving it empty means the provider can only serve as a mirror or backup member; as a publish target the upload is rolled back with `Upload succeeded but the provider did not return a public URL`. The field label, the five provider step lists and the OSS / COS guides now say that conditionally, and `check_user_flow.py` pins the wording to the backend facts.
- Tutorials may only name reachable UI, and errors may only reach the user through one channel; both are now enforced per file.

## 1.4.1 - Image Loading, Tutorial Reachability, Docs Publishing

- Fix the Gallery / Assets / Cloud Browser image storm: each card rendered the same remote original twice and only the main image was lazy, so the eager blur backdrop fetched a full-size image for every mounted tile and decoded it on the main thread. Tiles now load near the viewport and decode asynchronously, enforced per `<img>` tag by `check_user_flow.py`.
- State plainly when a èµæº search only covers the loaded page instead of the whole index.
- Tell tutorials to open only UI that exists: the R2 guide pointed at a æ¹æ¡ page and a ä¸ä¼ èµæº button that have no navigation entry, and two pages quoted panel names the app does not render. `check_docs_site.py` now derives the sidebar from `AppShell.tsx` and rejects instructions whose first segment is not a real navigation item.
- Publish `website/` to GitHub Pages from `docs.yml` and build the desktop bundle against that same base URL, probing it first: reachable means the app shows online tutorial links, unpublished means the links stay hidden instead of shipping dead ones. A missing docs site no longer blocks a release.
- Document the Local HTTP API (endpoints, Bearer auth, status codes, 32 MiB behaviour, no CORS) and link it from the Settings API panel; it had been the only shipped entry point with no tutorial.

## 1.4.0 Preview - UX / Sync / Theme consolidation

- Rebrand the active development line as **å¾åº | Image Hosting Platform** and align desktop/docs package metadata on v1.4.0.
- Add metadata-only cloud asset index sync so existing images in GitHub / Gitee / R2 / S3 / OSS / COS / WebDAV can appear in the Asset Index without downloading image bodies.
- Keep **èµæº** and **å¾åº** as separate concepts: Asset Index for metadata/output/multi-cloud state, remote Gallery for live Provider browsing.
- Harden GitHub browsing when the configured root does not exist yet and retry upload conflicts after refreshing remote state.
- Add the v1.4 Theme Engine foundation with design tokens, presets, accent color, wallpaper URL, glass strength and blur controls.
- Add first-run Help Center onboarding while keeping it reopenable from the sidebar.
- Replace misleading Typora âone-click configurationâ wording with an explicit Custom Command configuration guide; the app copies the command and opens Typora but does not silently rewrite Typora settings.
- Upgrade Gallery presentation toward a photo-album layout and make copy actions explicit.
- Make the main application content area independently scrollable so long Settings / Plugins / AI sections remain reachable.
- Clean temporary cloud-index wiring scripts/workflows after the guarded implementation landed.
- Upgrade Release Bundle so `v*` tags can publish Windows installers, tracked-source archive and SHA256 checksums to GitHub Releases; manual dispatch remains a build-only preview path.
- Keep the legacy Tauri application identifier and Rust library crate name for upgrade/source compatibility while public product/package naming moves to Image Hosting Platform.

## 1.3.5 - Task Control, Plugin Observability & Diagnostics

- Added cooperative cancellation for persistent Cloud Manager batch delete/move/rename tasks.
- Added item-level progress updates that cannot revive a task after it has been cancelled.
- Added bounded retry for failed/cancelled Cloud Manager batch tasks using the original persisted payload and a maximum retry budget.
- Added Task Center cancel/retry controls plus retry-attempt visibility.
- Added migration `0013_plugin_execution_logs.sql` and persistent plugin execution audit records for hook, status, duration and failure summary.
- Audit Desktop, Typora/Local API and manual plugin executions through the same plugin repository.
- Added a plugin-page execution activity panel for recent success/failure timing.
- Added Settings system diagnostics for Local API, Storage, plugins, default Workflow and task health.

## 1.3.4 - Lifecycle Completion & Persistent Cloud Tasks

- Added `before_process`, `after_process` and `on_publish_failure` plugin hooks.
- Unified expanded lifecycle execution across Desktop, Typora and the Local HTTP API bridge.
- Upgraded the official Webhook manifest to v1.2.0 without auto-enabling newly introduced hooks.
- Added migration `0012_official_webhook_lifecycle.sql` for existing installs.
- Moved provider-neutral cloud move overwrite/fallback/rollback semantics into `application::CloudMutationCore`.
- Added persistent Task Center jobs for batch cloud delete, move and template rename.
- Updated Cloud Manager to enqueue long-running batch mutations instead of blocking the page.
- Fixed CLI `PluginContext` construction to include lifecycle metadata.

## 1.3.3 - Lifecycle Hooks & Batch Cloud Operations

- Add explicit plugin lifecycle hooks with persisted per-plugin user selections; legacy installs default to `after_upload` only.
- Add host-runtime hook gating and first-class `after_upload`, `on_gallery_delete` and `manual_trigger` events.
- Let Webhook Publisher optionally receive real cloud-delete events with storage/path metadata without making plugin failures roll back a completed remote delete.
- Add Cloud Manager batch move and safe template batch rename with `{name}`, `{stem}`, `{ext}` and `{index}` placeholders.
- Keep batch mutations bounded to 100 files, preserve destination overwrite protection and reconcile Deployment locations after successful moves.
- Split cloud-management and plugin commands into dedicated Rust command modules to continue reducing the monolithic Tauri API layer.
- Expand command contracts to 60/60/60 and source user-flow/reliability/lifecycle contracts to 103 checks.

## 1.3.2 - Zero-context Upload & Cloud Manager Mutations

- Add a real global shortcut (`CommandOrControl+Shift+U`) that uploads the clipboard image through the existing default Workflow and writes final URLs back to the clipboard.
- Persist the global-shortcut preference and actually unregister the OS shortcut when disabled so the key combination is released for other applications.
- Add a Windows Explorer current-user image context-menu integration backed by `--shell-upload`; no administrator-level registry write is required.
- Keep shell, shortcut, Typora, Local HTTP API and desktop uploads on the same default Workflow / multi-cloud / plugin path.
- Extend `StorageProvider` with move/create-directory capabilities and implement native OpenDAL rename/create-dir operations.
- Add safe cloud move fallback (download â upload â delete), destination-overwrite protection and rollback of the destination if source deletion fails.
- Reconcile SQLite Deployment `remote_path` / `public_url` after cloud moves and mark active deployments deleted after batch cloud deletes.
- Upgrade Cloud Manager with create directory, rename, move, multi-select and bounded batch delete controls.
- Expand source user-flow/reliability/integration/cloud-manager contracts from 79 to 93 checks and Tauri command contracts from 49/49/49 to 57/57/57.

## 1.3.1 - Integration Layer & Background Publisher

- Add a token-protected Local HTTP API bound only to `127.0.0.1:36677` for scripts, ShareX-style tools, editor integrations and future agents.
- Reuse the existing default Workflow bridge for both raw-body and local-path HTTP uploads; no second uploader implementation is introduced.
- Keep the Local API token in OS Credential Store and support in-app token rotation that invalidates previous clients immediately.
- Add a real Tauri system tray entry; closing the main window hides it instead of terminating the background publisher, while the tray menu provides explicit open/quit actions.
- Move Typora/output/integration commands out of the monolithic `commands.rs` into `commands/integrations.rs` as the first command-layer decomposition.
- Move CPU-heavy workflow image decode/resize/encode work to Tokio blocking workers for both desktop and CLI/Typora paths.
- Add Settings UI for Local API status, token copy/rotation and call examples.
- Harden command-contract validation to scan nested Rust command modules and keep frontend/Rust/Tauri registration at 49/49/49.
- Expand source user-flow/reliability/integration contracts from 69 to 79 checks.

## 1.3.0 - Publisher Core, Publish Center & Cloud Manager

- Move Storage Group strategy semantics into `application::PublisherCore`; Tauri now delegates `mirror_all` and ordered primary/backup failover instead of owning those rules.
- Make a new Publish Center the default desktop entry: current target, quick target switching, drag/drop, clipboard, URL, output-format controls, recent assets and recent tasks.
- Keep every Publish Center action on the existing hidden workflow/task path instead of introducing a second uploader implementation.
- Upgrade Gallery/Storage Browser with remote download and confirmed permanent delete.
- Reconcile direct cloud deletes back into SQLite by marking every matching active Deployment as deleted.
- Add two Tauri cloud-management commands and keep frontend/backend/registration contracts at 47/47/47.
- Preserve v1.2.5 integrity hardening, plugin Permission Gate and OS credential isolation.
- Product direction is informed by PicGo's low-friction upload flow and PicList's cloud-management/task experience, without copying their Electron/npm-plugin security model.

## 1.2.5 - Publish Integrity Hardening

- Let backup failover survive desktop preflight instead of rejecting a group when Primary is temporarily unhealthy.
- Validate URL batches before task creation so an invalid later URL cannot leave hidden partial tasks.
- Make new remote paths unique per publish and protect shared legacy remote objects during deletion.
- Verify repair sources against the stored content hash before copying them to other clouds.
- Persist Typora partial/cloud/plugin warnings as completed-with-warning, matching the desktop task model.
- Add compensation cleanup when a safe unique remote upload succeeds but local persistence fails.
- Strengthen object-storage and Gitee connection tests, automatic-pipeline setup, long-history loading and public URL validation.

## 1.2.4 - Explicit Plugin Authorization

- Separate plugin Manifest declarations from user-granted permissions; declaration alone no longer authorizes a capability.
- Persist `granted_permissions_json` in SQLite and add migration `0010_plugin_permission_grants.sql`.
- Existing plugins keep only baseline `read_asset`; plugins requesting network, secrets, or external writes are disabled until the user explicitly re-authorizes them.
- Add `set_plugin_permissions` as a Tauri command and share the same grant state across desktop uploads and Typora CLI uploads.
- Add plugin-page permission confirmation before enabling a plugin with missing grants, plus a one-click way to revoke sensitive grants.
- Keep v1.2.3 reliability fixes: real backup failover, GitHub write-access validation, multimodal AI Caption, remote SHA verification and automatic hidden publish chain.
- Expand user-flow/reliability regression contracts from 33 to 40 checks.
- Dependency lock policy remains honest: networked CI generates the resolved lock files and then uses `cargo --locked` / `npm ci`; this offline package does not fabricate lockfiles.

## 1.2.3 - Publish Reliability & Plugin Safety

- Keep the hidden automatic publish chain introduced in v1.2.2 and preserve the single user flow across local, URL, clipboard and Typora uploads.
- Make `primary_with_backups` real failover semantics: mirrors always publish, backups publish only if the primary fails or cannot be initialized.
- Make GitHub connection tests reject tokens that can read the repository but do not have effective repository write access.
- Send the actual remote image as OpenAI-compatible `image_url` multimodal content for AI Image Caption.
- Enforce plugin manifest permissions inside the host runtime for asset reads, network calls, secrets and external writes.
- Upgrade existing official AI Caption plugin manifests to request `secret` permission.
- Pin direct npm dependency versions and make CI/release resolve lock files first, then build with `cargo --locked` and `npm ci`; publish the resolved locks as an artifact.
- Expand user-flow regression checks from 22 to 33 contracts.
- Retain plugin output persistence, post-plugin `asset://published`, OS credential storage for AI keys and automatic default target repair.

## 1.2.1 - Plugin Switches

- Replace the primary âæ¹æ¡â navigation entry with a single plugin control surface.
- Make installed plugins first-class on/off switches; add enable-all and disable-all actions.
- Enabled plugins now participate automatically after successful uploads, including Typora uploads.
- Keep workflow records as an internal processing compatibility layer instead of exposing them as a primary product concept.
- Update Typora and upload copy so users think in terms of upload target + enabled plugins.

## 1.2.0 - Plugin Runtime + AI Planner

- Add manifest-based plugin runtime and plugin marketplace UI.
- Add plugin persistence migration and enable/disable/config/remove commands.
- Add template, webhook and OpenAI-compatible AI prompt host runtimes.
- Add AI provider settings and natural-language workflow planner.
- Keep third-party native code disabled; WASM sandbox remains future work.
