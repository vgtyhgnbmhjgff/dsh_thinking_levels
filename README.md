# dsh-thinking-levels · 思考等級

為 DeepSeek Harness 增加一個**設置 → 思考等級**頁面：自動識別你在
`llm-pi-ai` 路由上配置的每一個自訂模型，並**讓每個模型單獨**決定它支持哪些
思考檔位（`reasoningEfforts`）。寫入走 Harness 自己的 `configEditor`，所以是
原子寫入、即時生效，不需要重啟。

```
設置 → 思考等級   （左側設置導覽，排在「模型」與「外掛」之間）
  └ 日日新 / sensenova1
      deepseek-flash        [off][minimal][low][medium][high][xhigh][max]
                            └ 每個已開啟的檔位右邊，就是端點自己的寫法
```

## 它做什麼

| 能力 | 說明 |
| --- | --- |
| 自動識別 | 直接讀 `configEditor.entries()` 裡的 `llm-pi-ai` 行，列出 `providers.<路由>.models[]`。新增、改名、刪除模型後按「重新識別」即可，不用重啟。 |
| 每個模型獨立 | 每次寫入只改**那一個模型**的 `reasoningEfforts`，同一個路由下的其他模型不受影響。 |
| 檔位 = DSH 檔位 | `off / minimal / low / medium / high / xhigh / max`，順序與 `dsh-llm-pi-ai` 的 `THINKING_LEVELS` 一致。 |
| 值 = 端點寫法 | 每個已開啟檔位的輸入框內容會原樣寫進 `reasoningEfforts[档位]`，例如 `high: "high"`、`max: "max"`。 |
| `off` 可以不傳值 | `off` 允許設成 `null`（= 支援、但不帶參數），這是 adapter 唯一允許留空的檔位。 |
| 清除 | 「⨯」移除該模型的 `reasoningEfforts` 欄位（模型恢復成「未宣告」），或只留 `off` 時會有提示。 |
| 安全網 | 寫入前由 `llm-pi-ai` 的 schema 驗證；本插件也會先擋下不可能的組合（未知檔位、非 `off` 的 `null`、`""`、只有 `off`）。 |

## 寫到哪裡

預設目標是 profile patch 中的這一行（可在 `cordis.patch.yml` 用 `targetRowId` /
`targetModule` 改）：

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      aihome:
        models:
          - id: deepseek-v4.1-flash-haha
            reasoningEfforts:     # ← 本插件只改這裡
              off: "off"
              low: "low"
              high: "high"
```

## 配置

```yaml
- insert:
    - id: thinking-levels
      name: 'dsh-thinking-levels'
      config:
        enabled: true
        targetRowId: llm-pi-ai                          # 依 id 找目標行
        targetModule: '@deepseek-ai/dsh-llm-pi-ai'      # 先依模組名找（改名也找得到）
        channel: /dsh-thinking-levels                   # 瀏覽器端 RPC 通道
        levels: [off, minimal, low, medium, high, xhigh, max]  # 省略即用內建順序
        minEntriesBeforeWrite: 8                        # profile 未掛好時拒絕寫入
        dryRun: false                                   # true = 只看不寫
```

## 架構

* **Host 半（`index.js`）**：掛一條 loopback `webServer` prefix 路由，用
  `connection.requestRejection` 套上和 `/api` 相同的鑑權；`state` 回傳偵測結果，
  `save` 透過 `configEditor.edit()` 改那一個模型並重新讀回驗證。
* **Client 半（`client.js`）**：純 JS 的 `settings.section` + `settings.section.icon`
  註冊，資料透過 `connection.rpc.call(channel, endpoint, payload)` 取得；沒有任何
  Harness 套件 import，樣式只用本 build 存在的 `--dsw-alias-*` token。
* **驗證**：在上一層目錄跑
  * `node verify-thinking-levels.mjs` — 用假的 Cordis 環境 + 真 HTTP server 驅動
    Host 通道，覆蓋鑑權、偵測、單一模型寫入、重新讀取驗證、各類拒絕（15 項）。
  * `node render-thinking-levels.mjs` — 用 React 替身實際 render 瀏覽器半，覆蓋
    註冊、載入後重繪、檔位切換、端點寫法編輯與儲存 payload。
* **已修過的問題**：`ModelCard` 曾把 store 方法呼叫在 snapshot 物件上
  （`snapshot.draftOf(...)`），資料載入後整個設定面板會變空白；已改為
  `store.draftOf(...)`，並由上面第二個 harness 守住。

## 限制

* 只處理 `llm-pi-ai` 這種「provider/models 寫在設定裡」的自訂模型；內建目錄模型
  （例如 `deepseek-account`）的檔位由它們自己的 adapter 決定，不在此頁。
* 內建目錄的模型不會出現，因為它們沒有可寫的 `reasoningEfforts`。
* 這裡設定的是「這個模型**支援**哪些檔位」；實際使用哪個檔位，仍由對話輸入框的
  模型選單決定。
