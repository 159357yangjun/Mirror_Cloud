# STATE

- 真仓：`D:\image-hosting-platform`（远端 github.com/159357yangjun/image-hosting-platform，public）
- dev 基线：`847f95a` = CI run#240 **success**（fmt/check/test 三关全绿；含 A/B 收口 + G1 信任边界 + D Local API auth-before-body + AGENTS/.ai V1）。复算：`curl -s https://api.github.com/repos/159357yangjun/image-hosting-platform/actions/runs?per_page=1`

- 版本声明：1.4.6（五处 + Cargo.lock 13 成员一致，门 `check_release_version.py` 看护）。
- 用户在用：`D:\Mirror Cloud`（v1.4.5 旧名资产包，无 ACL 修复的更早批——等他换装新包）。
- 在飞关卡：E HTTP 凭据政策 → F(G2) RC 构建 → G(G3) 真机 E2E → H(G4) v1.4.7 不可变 tag。
