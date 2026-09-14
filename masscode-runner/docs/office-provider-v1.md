# Office Provider API v1

CodeScope 始终内置不依赖外部环境的 Office Provider；桌面安装包还可以携带独立的高保真 Provider。应用启动时会校验 Provider 清单和可执行文件摘要，启动服务并等待健康检查成功，然后把 Web 与桌面端统一切换到该 Provider。

状态接口：`GET /api/office/providers/v1`。返回当前 Provider、能力矩阵和全部候选项。`?refresh=0` 可跳过外部健康探测。

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

`apiRevision` 不匹配、平台产物缺失或 SHA-256 不一致时，桌面端拒绝执行侧车并继续使用内置 Provider。侧车必须提供健康检查，以及与现有 ONLYOFFICE Docs API 兼容的编辑器静态资源；文档读取和保存仍通过 CodeScope 的短期签名接口完成。

## 更新边界

- 应用程序、内置 Provider 和随包侧车跟随 CodeScope Release 更新。
- Provider 的缓存、日志和临时文件必须写入系统应用数据目录，不得写入安装目录或 Vault。
- 后续增加 Provider v2 时保留 v1 接口；只有不兼容变更才提升 `apiRevision`。
- Web 部署可以通过 `CODESCOPE_ONLYOFFICE_URL` 连接独立服务，桌面端和 Web 端共用相同前端选择逻辑。
