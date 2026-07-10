// electron-builder afterPack 훅 — node-pty 네이티브 바이너리 배치 보증 + 릴리즈 가드.
//
// 배경: `@homebridge/node-pty-prebuilt-multiarch` 는 N-API(node-addon-api ^7) 기반이라
// 바이너리가 Node/Electron ABI 에 무관하게 동작한다(리빌드 불필요). 그런데 electron-builder
// 의 node_modules 파일 수집이 `build/Release/*.node` 를 통째로 드롭해, 패키지 앱에서
// `require('../build/Release/conpty.node')` 가 MODULE_NOT_FOUND 로 터지고 인앱 터미널이
// "터미널 시작 실패: Cannot find module '../build/Release/conpty.node'" 를 낸다(v0.15~v0.17).
//
// 실제 수정은 package.json `build.files` 에 node-pty 패키지를 명시 포함해 electron-builder 가
// asar 인덱스에 unpacked 로 기록하게 하는 것이다. asar 리다이렉트는 파일이 asar 인덱스에
// 있어야 동작하므로, 사후 복사만으로는 고쳐지지 않는다. 따라서 이 훅은 **검증 가드**다:
// 팩 결과의 unpacked 에 필수 바이너리가 없으면 빌드를 실패시켜, 깨진 터미널을 다시 릴리즈하는
// 회귀를 즉시 차단한다.
const fs = require("fs");
const path = require("path");

const PKG = "@homebridge/node-pty-prebuilt-multiarch";

// windowsPtyAgent.js 가 런타임에 반드시 로드하는 파일(win32).
const REQUIRED_WIN = ["build/Release/conpty.node", "build/Release/pty.node"];

exports.default = async function afterPack(context) {
  const platform =
    context.electronPlatformName ||
    (context.packager && context.packager.platform && context.packager.platform.name) ||
    "";
  // node-pty Windows 바이너리는 win32 타깃에만 해당.
  if (!/^win/i.test(platform)) return;

  const unpackedRoot = path.join(
    context.appOutDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    PKG,
  );

  const missing = [];
  for (const rel of REQUIRED_WIN) {
    const file = path.join(unpackedRoot, rel);
    if (!fs.existsSync(file)) missing.push(file);
  }

  if (missing.length > 0) {
    throw new Error(
      `[after-pack] node-pty 네이티브 바이너리가 패키지에 없습니다. 인앱 터미널이 깨진 채로 릴리즈됩니다.\n` +
        `누락:\n  - ${missing.join("\n  - ")}\n` +
        `package.json build.files 의 node-pty 명시 포함이 유효한지 확인하세요.`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[after-pack] node-pty 네이티브 바이너리 확인됨: ${unpackedRoot}\\build\\Release`);
};
