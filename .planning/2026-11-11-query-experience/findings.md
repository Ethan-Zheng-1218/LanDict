# Findings

- QueryPage 的 query 参数为已提交查询；input 在 query 改变后被清空，需分离且保留编辑状态。
- Enter 已有处理，长文本保留换行/Ctrl+Enter 语义；补 IME composition/keyCode 229 防护。
- historyStore 本地保存最近 30 条、去重置顶；浮层复用最新五条，不在预览时写记录。
- 本地原子 lookupWords 可只传当前词，不走 lemma 或联网；释义按词典顺序取简短片段，无可靠义项频率字段。
- Base UI 1.8.0 已安装 Popover，支持 anchor ref、受控 open 和 initialFocus/finalFocus=false，无需新依赖。
- 原有 dictionary 样式包含后代 span 规则；正文可点击 span 必须恢复继承样式，防止字体及搭配胶囊重复变化。
- shadcn CLI info 因 registry 网络断开失败，改为读取已安装 Base UI 类型确认 API。
- 初始仅用户未跟踪图片/安装包等文件，保留不动。
