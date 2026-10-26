# 📚 学习小站

一个给中学生用的学习记录系统：点一下开始、点一下结束，时间都自动按当前时间记录；结束时填写学习量，系统根据学习量和时长自动评估**专注度**和**学习效果**（满分各 100 分）。

## 使用方法

网页通过 GitHub Pages 发布（见下方「部署」），手机和电脑用浏览器打开网址即可；也可以直接双击打开 `index.html` 在本机使用。
配置 Supabase 后，用同一个账号登录的所有设备会自动同步学习记录；不配置则数据只保存在本机浏览器里（可在「设置」中导出/导入备份）。

1. **选择科目**：语文、数学、英语、物理、化学、生物、历史、地理、道法/政治、科学、信息技术、通用技术、音乐、美术、体育与健康、书法、第二外语、综合实践、其他，还可以在设置中自定义添加或隐藏科目。
2. **选择学习方式**：做题练习、写作业、阅读/预习、背诵/记忆、复习/整理、写作/练笔、听力/口语、技能练习。
3. **开始学习**：开始时间自动记录为当前时间；中途可以暂停/继续（暂停时间不计入有效学习时间，暂停次数算作中断）。
4. **结束学习**：结束时间自动记录为当前时间，填写学习量（题数、页数、字数等）、做对的题数、走神次数、自评专注和掌握程度，然后自动得出评分和改进建议。
   - **学习内容可以语音或拍照录入**：点 🎤 说话，文字实时出现在输入框里；点 📷 拍下课本、作业或笔记，自动识别成文字。识别结果都可以手动修改。
5. **记录 / 统计**：按天查看每条记录；统计页显示近 7 天/30 天的学习时长、分数走势、各科时长和薄弱科目提示。

刷新页面或关闭浏览器不会丢失正在进行的计时。

## 语音和拍照识别

- **语音输入**：使用浏览器自带的语音识别（Web Speech API），不需要密钥，可选普通话 / English / 粤语，英语科目默认英文。
  - 支持 Chrome、Edge、Safari（含 iPhone）；Firefox 和微信等内置浏览器不支持。第一次使用时浏览器会询问麦克风权限。
  - 语音由浏览器厂商的服务识别：Chrome 用 Google，Safari 用 Apple，Edge 用 Microsoft。某些地区 Chrome 的语音服务连不上，这时可以换 Safari / Edge，或直接用手机输入法键盘上的话筒键。
- **拍照识别**：使用 [Tesseract.js](https://github.com/naptha/tesseract.js) 在**本机浏览器里**识别（中文简体 + 英文），**照片不会上传到任何地方**。
  - 第一次使用时会从 jsDelivr 下载识别引擎和语言模型（约 5MB，之后浏览器会缓存）。
  - 印刷体（课本、试卷、打印资料）识别效果好；手写字、公式、斜着拍或光线暗的照片效果会差一些，所以识别后请检查修改。拍的时候尽量光线充足、正对着、文字占满画面。

## 评分规则

学习效率 = 学习量 ÷ 参考量，参考量 = 有效学习分钟数 × 参考速度（按科目和学习方式设定，例如数学做题约 0.35 题/分钟，英语做题约 0.8 题/分钟，阅读约 0.8 页/分钟），达到参考量的 90% 即得满分。

| 专注度（100） | 分值 | 学习效果（100） | 分值 |
| --- | --- | --- | --- |
| 有效时长占比（≥95% 满分） | 35 | 学习量达成 | 30 |
| 少走神/少中断（每 30 分钟中断次数） | 25 | 正确率/掌握度 | 35 |
| 学习效率 | 25 | 有效学习时长（≥40 分钟满分） | 15 |
| 自我评价 | 15 | 专注度加成（专注度 × 20%） | 20 |

等级：🌟 优秀 ≥ 90，👍 良好 ≥ 75，🙂 合格 ≥ 60，💪 加油 < 60。

学习量是**选填**的：没填时，「学习效率」和「学习量达成」两项按其余各项的得分比例估算，既不扣分也不白送分；学习内容可以随意输入。

参考速度和各项权重都在 `js/scoring.js` 中，可以按自己的实际情况调整。

## 云同步（Supabase）

本仓库已经连接到 Supabase 项目 `gavin study`（`js/config.js` 已填好，数据表已建好），下面是从零搭建时的步骤，供参考。

1. 在 [supabase.com](https://supabase.com) 注册并新建一个项目（免费版即可）。
2. 打开项目的 **SQL Editor**，把 [`supabase/schema.sql`](supabase/schema.sql) 的全部内容粘贴进去运行一次。它会建好两张表，并开启行级安全（每个账号只能读写自己的数据）。
3. 打开 **Project Settings → API**，复制 **Project URL** 和 **anon / publishable key**。
4. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 中新建两个仓库变量：
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon / publishable key

   （也可以直接把这两个值填进 `js/config.js` 再提交。anon key 本来就是给网页用的公开密钥，数据靠行级安全保护；**千万不要填 service_role / secret key**。）
5. 打开 **Authentication → URL Configuration**，把 **Site URL** 设为网页地址（如 `https://<用户名>.github.io/gavin-study/`），并把同一地址加入 **Redirect URLs**。这样注册确认邮件和重置密码邮件里的链接才会跳回网页。
6. 可选：如果不想注册时收确认邮件，可以在 **Authentication → Sign In / Providers → Email** 关闭 **Confirm email**。

同步规则：
- 记录先保存在本机，联网且登录时自动上传，并每 30 秒、切回页面时拉取其他设备的改动；离线时照常使用，联网后自动补传。
- 第一次登录时，这台设备上已有的记录会自动上传并与云端合并。
- 正在进行的计时也会同步：在电脑上开始，可以在手机上结束。
- 退出登录会清除本机上的记录（云端保留），方便在公用设备上使用。

## 每晚学习日报（邮件）

每晚 23:30（北京时间）由 Supabase 云端自动把当天的学习记录汇总成邮件，发到账号的登录邮箱：总学习时间、各科时长、平均专注度和学习效果、每次学习的明细和学习内容。当天没有学习也会发一封“今天没有学习记录”。网页「设置 → 每晚学习日报」里可以开关，也可以立即发一封测试邮件。

原理：`pg_cron` 每晚定时调用 Edge Function `daily-report`，函数用 SMTP 发信（默认用 QQ 邮箱，端口 465）。关闭网页、关机都不影响。

一次性配置（只需做一次）：
1. **发件邮箱的授权码**：登录 QQ 邮箱网页版 → 设置 → 账号 → 开启「POP3/SMTP 服务」→ 生成**授权码**（不是 QQ 密码）。
2. 在 Supabase 控制台 **Edge Functions → Secrets** 添加：
   - `SMTP_USER` = 发件 QQ 邮箱地址（如 `123456@qq.com`）
   - `SMTP_PASS` = 上一步的授权码
   - 可选 `SMTP_HOST` / `SMTP_PORT`：默认 `smtp.qq.com` / `465`，用 163 邮箱可改成 `smtp.163.com` / `465`（Supabase 云函数连不上 25 和 587 端口，请用 465）
   - 可选 `REPORT_CC`：所有日报都抄送的邮箱，多个用逗号分隔（比如家长的邮箱）。网页上改不了这一项
3. 部署函数 `supabase/functions/daily-report`（`supabase functions deploy daily-report --no-verify-jwt`，或用 Supabase 的 MCP 部署），再在 SQL Editor 运行 [`supabase/daily_report.sql`](supabase/daily_report.sql)。

安全设计：
- 日报只发到**账号自己验证过的登录邮箱**（外加你在 `REPORT_CC` 里设置的邮箱）。网页上不能填任意收件地址，避免被人拿来群发垃圾邮件。
- 定时调用靠数据库里随机生成的密钥校验，网页端读不到；测试邮件靠用户登录令牌校验，每人每天最多 5 封。
- 同一天不会重复发送，23:45 会自动补发一次失败的。

## 部署（GitHub Pages）

仓库自带 `.github/workflows/pages.yml`：代码合并到 `main` 分支后，会自动跑测试并发布网页。

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 合并到 `main`（或在 **Actions** 页手动运行 “Deploy to GitHub Pages”），完成后网址显示在 Pages 设置页，一般是 `https://<用户名>.github.io/gavin-study/`。

注意：免费的 GitHub 账号只能给**公开仓库**开启 Pages；私有仓库需要 GitHub Pro。仓库里没有任何密码或密钥（anon key 是公开的），设为公开也没有安全问题，学习记录存在 Supabase 中、不会出现在仓库里。

## 开发

```
npm test   # 运行评分模型的单元测试（需要 Node 18+）
```

- `index.html` — 页面
- `css/style.css` — 样式（支持浅色/深色）
- `js/scoring.js` — 科目、学习方式与评分模型
- `js/app.js` — 计时、记录、统计、设置等交互
- `js/cloud.js` — Supabase 登录与同步
- `js/capture.js` — 语音和拍照识别录入学习内容
- `js/config.js` — Supabase 配置（留空 = 仅本机）
- `supabase/schema.sql` — 数据库表和访问权限
- `supabase/functions/daily-report/` — 每晚日报邮件的云函数（`report.mjs` 内容生成，`core.mjs` 流程，`index.ts` 接线）
- `supabase/daily_report.sql` — 日报的发送记录表和每晚 23:30 的定时任务
