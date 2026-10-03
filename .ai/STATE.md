# STATE

- 真仓：`D:\image-hosting-platform`（远端 github.com/159357yangjun/image-hosting-platform，public）
- dev 基线：`5510a2c` = CI run#245 **success**（fmt/check/test 三关全绿；含 A/B 收口 + G1 信任边界 + D Local API auth-before-body + E 端点 HTTPS/loopback 政策 + AGENTS/.ai V1）。复算：`curl -s https://api.github.com/repos/159357yangjun/image-hosting-platform/actions/runs?per_page=1`

- 版本声明：1.4.6（五处 + Cargo.lock 13 成员一致，门 `check_release_version.py` 看护）。
- 用户在用：`D:\Mirror Cloud`（v1.4.5 旧名资产包，无 ACL 修复的更早批——等他换装新包）。
- 在飞关卡：F(G2) RC 构建 → G(G3) 真机 E2E → H(G4) v1.4.7 不可变 tag。
