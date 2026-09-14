# Office Provider API v1

CodeScope 只使用 ONLYOFFICE Docs 作为 Office 编辑内核，不再提供内置兼容编辑器或自动降级。Document Server 可以是团队共享服务、本机 Docker 服务，或由发行包声明的受管侧车。Web 与桌面端使用相同的连接、文档读取、回调保存和状态接口。

状态接口：`GET /api/office/providers/v1`。返回 ONLYOFFICE Provider、能力矩阵和连接状态。服务不可用时 `active` 为 `null`，Office 工作区显示连接页。`?refresh=0` 可跳过健康探测。

连接接口：

- `GET /api/office/connection` 返回服务地址、回调地址、配置来源和是否已设置 JWT；永不返回 JWT 明文。
- `POST /api/office/connection` 保存并立即应用 `publicUrl`、`callbackBase`、`jwtSecret`。远程 Document Server 必须提供它能够访问的回调地址。
- 部署环境也可设置 `CODESCOPE_ONLYOFFICE_URL`、`CODESCOPE_ONLYOFFICE_CALLBACK_BASE`、`CODESCOPE_ONLYOFFICE_JWT_SECRET`，其优先级高于界面保存值。

配置文件位于 CodeScope 应用数据目录的 `office-connection.json`，创建时使用 `0600` 权限。编辑器配置按 `JWT_SECRET` 生成 HS256 JWT；文档下载 URL 和保存回调 URL 另有进程级 HMAC 签名。

## 随包目录

构建前把 Provider 放入 `masscode-runner/.office-provider/`，或设置 `CODESCOPE_OFFICE_PROVIDER_BUNDLE`：

```text
.office-provider/
├── manifest.json
└── bin/
    └── provider executable
```

发布包会把该目录复制到 Electron 的 `resources/.office-provider/`（也兼容发行流水线重命名为 `resources/office-provider/`）。升级 CodeScope 时 Provider 一并原子替换，不写入 Vault。

## manifest.json

```json
{
  "id": "codescope-onlyoffice",
  "version": "9.4.0",
  "apiRevision": 1,
  "publicUrl": "http://127.0.0.1:8088",
  "healthUrl": "http://127.0.0.1:8088/healthcheck",
  "platforms": {
    "darwin": {
      "arm64": {
        "executable": "bin/office-provider-arm64",
        "sha256": "...",
        "args": ["--port", "8088"],
        "startupTimeoutMs": 90000
      }
    },
    "win32": {
      "x64": {
        "executable": "bin/office-provider.exe",
        "sha256": "..."
      }
    },
    "linux": {
      "x64": {
        "executable": "bin/office-provider",
        "sha256": "..."
      }
    }
  }
}
```

`apiRevision` 不匹配、平台产物缺失或 SHA-256 不一致时，桌面端拒绝执行侧车，并把 Office 标记为未连接；不会启动其他编辑器。侧车必须提供健康检查，以及与 ONLYOFFICE Docs API 兼容的编辑器静态资源；文档读取和保存仍通过 CodeScope 的签名接口完成。

## 更新边界

- CodeScope 应用和可选的受管侧车跟随 CodeScope Release 更新；独立 ONLYOFFICE 服务可以按自己的维护窗口更新。
- Provider 的缓存、日志和临时文件必须写入系统应用数据目录，不得写入安装目录或 Vault。
- 后续增加 Provider v2 时保留 v1 接口；只有不兼容变更才提升 `apiRevision`。
- Web 与桌面部署都可连接独立服务，且共用相同前端选择逻辑。升级服务地址不修改 Vault，也无需迁移 Office 文件。
