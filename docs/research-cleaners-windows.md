# Windows 清理 / 优化软件 UI 调研（2025–2026）

> 调研日期：2026-11-25。方法：仅网页搜索与页面阅读，未下载、未安装、未注册任何软件。
> 因此所有"流程"描述来自官方截图、官方文档与第三方评测，不是本人上手实测。

## 0. 阅读说明

每条事实后的标记表示证据强度：

| 标记 | 含义 |
|---|---|
| **[图证]** | 我在浏览器中亲眼看过该官方截图/官方页面，描述是对图的直接转述 |
| **[官方]** | 来自厂商官网、帮助文档、版本说明的文字 |
| **[评测]** | 来自第三方评测 / 媒体 / 用户论坛的文字（注意日期，很多评测偏旧） |
| **[未核实]** | 本次调研没有找到可引用来源，属于行业常识或我的既有认知，使用前请自行确认 |

三个需要先知道的"与预期不符"的发现：

1. **MacPaw CleanMy® PC 已停产，不存在"新的 Windows 版 CleanMyPC"**。MacPaw 官方：2021-12-01 停止积极开发，2025-04-22 起停止开发、销售、更新与支持，理由是公司只专注 Apple 生态。[官方] <https://macpaw.com/support/cleanmypc/knowledgebase/sunset>
2. **CCleaner 7（2025-10）的重设计在老用户中口碑很差**，是"把专业工具做成极简向导"的反面教材（详见 1.1）。
3. **腾讯电脑管家已到 18.x（2026-03 发布 18.0），首页主打"AI 安全助手"**，清理被降为首页的一块；同样有老用户抱怨"极简过头找不到功能"。

---

## 1. 逐产品记录

### 1.1 CCleaner 7（Gen Digital / Piriform）

- **版本**：7.0 于 2025-10 发布，全新界面、ARM64 支持、新卸载引擎；不再支持 Win7/8.1。[评测] <https://betanews.com/2025/10/07/ccleaner-7-debuts-with-redesigned-interface-and-smarter-cleanup-tools/> ；<https://free-codecs.com/news/ccleaner-7-launches-with-batch-uninstaller-and-built-in-duplicate-file-finder.htm>
- **(1) 首页** [图证]：默认落在 Health Check。右侧白色内容区居中只有 4 样东西：一幅扁平蓝色人物插画（女孩拿风车）、标题 "Run your first scan"、两行说明（"Scan your PC and apply updates in just a few clicks. Don't worry, no data will be cleaned without asking you first."）、一个蓝色胶囊按钮 "Scan now"。底部贴一条升级横幅："You have **programs slowing down** your PC" + 黄色 "Resolve" 按钮。屏幕上总元素约 15 个（9 个导航项 + 3 个底部项 + 英雄区 + 横幅）。
- **(2) 导航** [图证]：左侧深蓝灰色侧栏（可折叠汉堡按钮）：Health Check / Custom Clean / Performance Optimizer / Driver Updater / Software Updater / Cloud Drive Cleaner / Uninstaller / Disk Analyzer / Startup Manager；底部 Ideas Portal / Settings / Help + 黄色 "Upgrade now"。
- **(3) 扫描到清理**：
  - Health Check 扫描后给出一个"体检结论页"，官方文档示例标题是 "Your PC feels under the weather"，分四类：Privacy（浏览器追踪数据）、Space（回收站与临时文件）、Speed（可禁用的启动项）、Security（待更新的应用）。**Privacy 与 Space 免费，Speed 与 Security 需 Professional**。[官方] <https://support.ccleaner.com/articles/en_US/Master_Article/what-is-health-check>
  - Custom Clean 是老的"勾选树 + Analyze + Run Cleaner"模式，给高级用户。[官方]
  - v7 新增：批量卸载、Disk Analyzer 内置重复文件查找（带图片缩略图，可"保留最新/最旧"）、删除时可选"永久删除 / 进回收站"、Custom Clean 新增 AI Tools 分类（清 ChatGPT、Claude 等应用垃圾）。[评测]
  - 完成页的具体文案、"Make it better" 按钮是否仍在：**[未核实]**
- **(4) 视觉** [图证]：深蓝灰侧栏 + 近白内容区；单一蓝色主按钮；扁平矢量插画（人物、猫 + 气球、齿轮）每个模块一幅；亮 / 暗 / 跟随系统三种主题；密度低，大量留白。
- **(5) 付费**：Free / Professional（1 台，首年约 RMB 228.69，续费 RMB 343.24/年）/ Professional Plus（3 台）。Pro 独占：Performance Optimizer（应用"睡眠"）、Driver Updater、Software Updater 自动更新、Cloud Drive Cleaner、自动清理/定时、优先支持。[图证+官方] <https://www.ccleaner.com/ccleaner>。视觉信号：**黄色**专用于升级（侧栏按钮、横幅 Resolve），与蓝色主操作区分。
- **(6) 评价**：
  - 媒体：界面更干净现代、响应更快。[评测]
  - 老用户（官方论坛长帖）：注册表清理被并进 Custom Clean；Cookie 保留名单丢失；"到设置要多点很多次"；窗口过大、小屏够不到按钮；启动项功能"藏得很深，令人起疑"；关窗后进程仍驻留；强制升级、无迁移路径；被形容为 "bloated"、"a big, ugly beast"。[评测] <https://community.ccleaner.com/t/feedback-on-version-7-and-why-i-uninstalled/156663>
  - 官方承认 v6 部分功能在 v7 暂缺并在收集反馈。[官方] <https://community.ccleaner.com/t/explore-what-s-new-in-ccleaner-7/158613>
- **截图**：
  - 首页：<https://www.free-codecs.com/guides/pictures/CCleaner-7-Run.png>
  - 欢迎页：<https://www.free-codecs.com/guides/pictures/CCleaner-7-Welcome_1.png>
  - 官网示意图（线框化）：<https://cdn-production.ccleaner.com/site/c55liiig/product-screenshot-illustration-a.png>

### 1.2 Microsoft PC Manager（微软电脑管家）

- **(1) 首页** [图证]：窄高的小窗（像手机比例）。自上而下：一张 "Windows tips" 提示卡；**PC boost 卡片是英雄区**，内含两个数字条 "64% Memory usage"、"1.8GB Temporary files"，一行结果反馈 "23MB of temporary files were released"、"Set Smart Boost" 链接，以及一个通栏深蓝 **Boost** 按钮；下方 2×2 入口卡：Health Check（Last check 日期）、Process（14 Apps）、Deep cleanup、Startup。
- **(2) 导航** [图证]：左侧图标 + 文字竖栏：Home / Protection / Storage / Apps / Toolbox。Storage 页列出 Deep cleanup、Manage large files、Storage sense 等行式入口。官网还宣传 Pop-up management（弹窗管理）与 Mini toolbar。[官方] <https://pcmanager.microsoft.com/en-us>
- **(3) 流程** [图证]：
  - Health check：顶部一个笔记本电脑小插图 + "Looking for issues…" + 细进度条 + 当前动作小字 "Scanning for junk files…" + Cancel；下面分组行 Items to cleanup / Viruses / Potential issues，各自右侧显示 "Scanning…"。完成后："Health check completed — All actions completed" + 绿色对勾徽章 + Done。
  - Deep cleanup 完成页："Cleanup completed — Freed **17.0 MB** of drive space"（数字蓝色加粗）+ Done；下方可展开分组 System cleanup，逐行列出 Windows Update clean…、Windows Prefetch、Windows Error Report…、Microsoft Defender Lo…、DirectX shader cache，每行右侧 "Cleaned"，部分带 ⓘ 说明。
  - 评测称 Boost 是"快速重置而非深度修复"，提醒清理 Windows Update 组件会影响回滚。[评测] <https://windowsforum.com/windows-news.4/microsoft-pc-manager-review-one-click-boost-cleanup-and-real-world-gains.398266/>
- **(4) 视觉** [图证]：Windows 11 Fluent：Mica 浅蓝灰底、白色圆角卡片、细线图标、单一深蓝强调色、无 3D、无大插画、几乎无装饰动画；密度中等。
- **(5) 付费**：免费，无付费层。[官方]
- **(6) 评价**：简洁、官方可信、无广告；被批"功能与系统自带重复""收益有限"；早期版本曾有推荐改默认浏览器等推广引发不满。[评测] <https://www.minitool.com/news/is-microsoft-pc-manager-worth-using.html>
- **截图**：
  - 首页：<https://pcmimage.officeplus.cn/images/enusSystemAccelerationNew.webp>
  - 体检中/完成：<https://pcmimage.officeplus.cn/images/enusPhysicalExaminationNew.webp>
  - 存储 + 清理完成：<https://pcmimage.officeplus.cn/images/enusSystemSpace.webp>
  - 工具箱：<https://pcmimage.officeplus.cn/images/enusToolbox.webp>

### 1.3 CleanMy® PC（MacPaw）——已停产

- 状态见第 0 节。最后的版本仍可下载，旧许可永久有效，但不再销售。[官方] <https://macpaw.com/support/cleanmypc/knowledgebase/sunset>
- 旧版 UI（评测，2021–2024）：左侧竖排模块列表，一进来就能看到所有功能；"光滑、有光泽、会解释自己在做什么"。模块：My Computer（垃圾扫描）、Registry Maintenance、Multi Uninstaller、Hibernation、Extensions、Autorun、Privacy、Shredder。[评测] <https://www.techadvisor.com/article/722579/macpaw-cleanmypc-review.html> ；<https://www.digitalcitizen.life/cleanmypc-review/>
- 设计启示：客户心中的"MacPaw 质感"现在只能参考 **CleanMyMac（macOS）**，Windows 上没有对应的现役产品。CleanMyMac 的界面本次未调研。[未核实]

### 1.4 IObit Advanced SystemCare 20（Free / Pro / Ultimate）

- **版本**：ASC 20 于 2026-10-15 发布，新增 Custom Clean（大文件 / 重复文件 / 垃圾三合一）、新扫描引擎、实时硬件监控。[官方] <https://www.iobit.com/en/advancedsystemcarepro.php>（新闻稿见 iobit.com pressroom）
- **(1) 首页** [图证]：全深色（近黑的藏蓝）。正中一个**巨大的圆形 SCAN 按钮**，外圈是发光的蓝色进度环；按钮下方是 **AI Mode / Manual Mode** 胶囊切换。除侧栏和右上角几个小图标外没有别的东西——整屏约 12 个元素。
- **(2) 导航** [图证+官方]：左侧竖栏 6 项：Care / Custom Clean / Speed Up / Protect / Software Updater / Action Center。Manual Mode 下列出 16 个可勾选模块（启动项优化、垃圾清理、快捷方式修复、注册表清理、隐私清理、间谍软件、系统弱点、安全漏洞等）。[官方手册] <http://www.iobit.com/product-manuals/asc-help/>
- **(3) 流程**：点 SCAN → 逐模块扫描 → 报告页逐项列出问题并解释"修复会做什么"，用户可选择修哪些 → Fix。旧评测称 AI 模式扫描约 3 分钟。[评测，2020 版] <https://www.techradar.com/sg/reviews/iobit-advanced-systemcare-free>
- **(4) 视觉** [图证]：暗色 + 霓虹蓝光环 + 玻璃拟物（官网配图里大量发光球体、"AI" 徽章、Before/After 磁盘条）；支持皮肤。风格偏"科幻仪表"。
- **(5) 付费**：Pro 首年约 $16.77（1 台）。Free 只有"基础清理 / 一键释放内存"；Pro 才有深度清理、**自动**释放内存、注册表清理、实时防护、自动体检、软件一键更新、隐私自动清除。[官方] 视觉信号：旧版评测指出免费版里被锁功能用**橙色**高亮，并不断出现升级提示。[评测]
- **(6) 评价**：一键扫描深、报告清楚；但**持续推销 Pro 和 IObit 其他产品**，安装时捆绑第三方软件（评测提到 Opera）、要求订阅邮件；Toolbox 里约 30 个工具有的只是其他 IObit 产品的安装器。[评测]
- **截图**：
  - Pro 首页（透视渲染）：<https://www.iobit.com/tpl/images/2025/product_pro/pro_pic.png>
  - Free 首页：<https://www.iobit.com/tpl/images/2025/product_pro/free_pic.png>
  - 旧版主界面：<https://cdn.mos.cms.futurecdn.net/Jer8A7tmjzHZicZ3oBPtHj.jpg>

### 1.5 Ashampoo WinOptimizer Pro 29

- **版本**：官网当前为 Pro 29；另有免费的 WinOptimizer 2026。[官方] <https://www.ashampoo.com/en-us/winoptimizer>
- **(1) 首页** [图证，官方渲染图]：深色。顶部标题 "Your PC is being analyzed" + 当前动作小字 + Cancel；右上角一个**速度表式仪表盘**；主体是 **2 行 × 4 列的结果磁贴**，每块一个圆形图标 + 大数字（如 17,987 / 3,598 / 1,921 / 3,434）+ 蓝色底条；底部是自动功能开关条。即"仪表盘式"首页，一屏约 20+ 元素，是本次所见最密的。
- **(2) 导航** [图证]：左侧竖栏：System analysis / Extended / Automatic / All modules / Clean / Optimize / Inform / Software Updates / Backups。可在"按用途分组"和"按模块名"两种视图间切换。[官方手册] <https://support.ashampoo.com/hc/en-us/articles/15610569229970-WinOptimizer-2024-Manual>
- **模块**（30+）：One-Click Optimizer（= Drive Cleaner + Internet Cleaner + Registry Optimizer）、Privacy Traces Cleaner、Live-Tuner、Startup Manager、Service Manager、DiskSpace Explorer、File Wiper、Undeleter、Auto-Clean、Game Booster 等。[官方]
- **(3) 流程**：Analyze（约 90 秒）→ 每块磁贴可点进详细报告，说明发现了什么、打算怎么修 → Optimize。[评测，v18，2020] <https://www.techradar.com/reviews/ashampoo-winoptimizer>
- **(4) 视觉**：暗 / 亮两套皮肤；蓝色强调；仪表盘 + 磁贴，偏工程感。
- **(5) 付费**：一次性买断为主（官网 "from $14"），免费版缺 Drive Cleaner、Registry Optimizer 等核心模块。[官方+评测]
- **(6) 评价**：模块全、可控；菜单切换略迟钝，误点 Clean 后要等 20–30 秒才能退出。[评测]
- **截图**：<https://img.ashampoo.com/ashampoo.com_images/img/1/products/7306/website-ashampoo-winoptimizer-29-render-front.png> ；媒体图库页 <https://www.ashampoo.com/zh-cn/winoptimizer/media>

### 1.6 AVG TuneUp

- **(1) 首页** [图证]：深色（石墨灰）。首页不是"开始扫描"，而是**直接就是扫描结果**："Your scan results"，副标题 "Take these steps to optimize your PC."，右上 "Last scan: 2 days ago" + RE-SCAN。主体是纵向卡片列表，每张卡片一个问题域：
  - Disk Cleaner — "**12.6 GB (14,273 items)** to clean"（数字橙色）— "Free up your storage space." — 绿色实心 **CLEAN NOW** + 描边 **SEE DATA**
  - Browser Cleaner、Broken shortcuts 同构。
  - 右栏：Help Center + **Statistics**（"Here's what you've done so far"：9.6 GB space regained / 10,127 items removed / 0 issues fixed）。
- **(2) 导航** [图证]：极窄的左侧图标栏（约 6 个图标 + 设置）。旧版是四大类 Maintenance / Speed Up / Free Up Space / Fix Problems + All Functions。[评测] <https://www.techradar.com/reviews/avg-tuneup>
- **(3) 流程**：首次 Scan Now → 结果卡片 → 每张卡片可一键 Clean Now 或先 See Data 查看明细 → 统计累加。[图证+官方]
- **(4) 视觉**：暗色、绿色 = 执行、橙色 = 待处理的量；无插画；密度中等。
- **(5) 付费**：纯订阅，首年 $29.99，续费 $69.99/年；无免费版，只有试用。[官方] <https://www.avg.com/en-us/avg-pctuneup>
- **(6) 评价**：仪表盘清晰易用；贵。[评测]
- **备注** [图证]：官方截图的帮助文案里写着 "Learn more about Norton Utilities Ultimate"——说明 Gen Digital 旗下 AVG TuneUp / Avast Cleanup / Norton Utilities 共用同一套界面骨架。
- **截图**：<https://static2.avg.com/10005055/web/i/page/avg-pctuneup-v2/ui1.png> ；<https://static2.avg.com/10005055/web/i/page/avg-pctuneup-v2/ui5.png>

### 1.7 Avast Cleanup Premium

- **(1) 首页** [图证]：深青蓝色。标题 "Your scan results" + "Remove unnecessary files to free up space and speed up your computer." + Rescan / "Last scan: 10 sec ago"。三行结果条：Broken Registry Keys（**12,569 items**）、Sleep Mode（**12 startup processes**）、App Uninstaller（**3 unused apps**），数字黄色，每行右侧 **Review** 按钮。下半部分是成就区："Here's what you've cleaned so far: 21.6 GB of space / 32,987 items removed" + 一条按月的面积图 + All statistics。
- **(2) 导航** [图证]：双层——最左是 Avast One 的图标栏，第二列是 Cleanup 的文字列表：Status / Browser Cleaner / Broken Shortcuts / Broken Registry Keys / Disk Cleaner / Cloud Cleaner / Sleep Mode / Uninstall Simulator / Uninstaller / Updater / Data Recovery / Data Shredder / Disk Manager / Undo Center。新安装时 Cleanup 已并入 Avast One 应用。[官方] <https://support.avast.com/en-us/article/4410>
- **(3) 流程**：Scan → 结果条 → Review 进明细 → 清理；有 **Undo Center** 可撤销；Automatic Maintenance 每周后台运行。[官方]
- **(4) 视觉**：暗色、黄色数字、橙色品牌点缀；用图表而不是插画。
- **(5) 付费**：订阅，1 台首年 $29.88（续费 $65.99）；30 天试用免信用卡。[官方] <https://www.avast.com/en-us/cleanup>
- **(6) 评价**：易用性"可以给满分"；缺点是**通知太多**、贵。[评测，2022] <https://www.techradar.com/reviews/avast-cleanup-premium>
- **截图**：<https://www.avast.com/content/dam/avast/ui-screens/bait/ui-cleanup-pc-bait-01-A1.png>

### 1.8 Norton Utilities Ultimate

- 未能看到当前版本的官方界面截图（官网产品页只有生活方式照片）。**UI 细节 [未核实]**；从 1.6 的备注推断与 AVG TuneUp 同骨架。
- 评测：标签式界面，一屏内容很少，沿用 Norton 360 的设计语言；扫描后报告"发现 N 个问题"并给 "review and fix" 按钮；可细调清理范围与自动频率；**没有免费版**；约 $69.99/年。[评测] <https://www.techadvisor.com/article/722824/norton-utilities-ultimate-review.html> ；<https://www.heise.de/download/specials/Norton-Utilities-im-Test-Was-taugt-die-aktuelle-Version-des-Klassikers-9826631>
- 官方页：<https://us.norton.com/products/norton-utilities-ultimate>

### 1.9 Glary Utilities 6（Free / Pro）

- **(1) 首页（Overview）** [图证]：浅色、淡蓝粉渐变底。英雄元素是 **Windows 开机时间**："00 h 00 m 28 s" 大数字 + 时钟图标 + 一句比较："Your Windows boot time is Fast, 68% of users are slower." + Startup Manager 按钮。下面是 4 个带 **PRO 角标**的开关（深度清理与修复、关机时擦除隐私痕迹、自动维护、启动时检查更新），再下面是版本 / 数据库日期 / 授权信息。底部一排 8 个图标快捷入口。左下角橙色 "Upgrade Now"。
- **(2) 导航** [图证]：左侧 7 项：Overview / 1-Click Maintenance / Clean Up & Repair / Optimize & Improve / Privacy & Security / Files & Folders / System Tools。
- **(3) 流程**：1-Click Maintenance 勾选若干项（注册表、快捷方式、间谍软件、磁盘修复、痕迹、临时文件、启动项）→ Scan → 逐项显示发现数量 → Repair。[评测] <https://www.techradar.com/reviews/glary-utilities>
- **(4) 视觉**：浅色、Windows 经典工具感，信息密度高；被评为"简单但偏旧"。
- **(5) 付费**：Free 功能已很全；Pro 加自动维护、深度清理、关机擦除、自动更新。信号：橙色 PRO 小角标 + 橙色升级按钮 + 标题栏 "FREE" 徽章。[图证]
- **(6) 评价**：免费给得多；界面过时；一键扫描发现的问题比 IObit 少。[评测]
- **截图**：<https://www.glarysoft.com/images/softbox/gu6-free.png?20231121>

### 1.10 Wise Care 365（v7）/ Wise Disk Cleaner

- **(1) 首页（PC Checkup）** [图证，v7.2.5]：深色顶栏 + 白色内容区。左侧一个蓝色大圆环，中间是 "?"（未体检状态）；标题 "**Running Slow? Check Up Now!**"；一行说明；绿色大胶囊按钮 **Checkup**。右栏：黄色 "Upgrade to PRO — Faster & More Secure"、"Wise Protection Off"（带 PRO 斜角标）、Utilities 3×3 图标宫格（Image Editor、Data Recovery、Duplicate Finder、Folder & File Hider、Force Deleter、Auto Shutdown、Memory Optimizer、Program Uninstaller、Fast Search）。左下角一个 OFF 开关："Clean up your computer regularly."
- **(2) 导航** [图证]：顶部大图标标签栏：PC Checkup / System Cleaner / System Tuneup / Privacy Protector / System Monitor / WiseX。System Cleaner 下分 Registry Cleaner、Common Cleaner、Advanced Cleaner、System Slimming、Big Files Manager（PRO）。[官方] <https://wisecleaner.com/wise-care-365-user-guide.html>
- **(3) 流程** [图证]：点 Checkup → 结果页顶部一条摘要："The scan has been completed. Scanned Sections: 93 · Elapsed Time: 20 Seconds · Total: **6028** · Total Size: **6.34 GB**" + 绿色 **Fix** + "Check again"。下面是可折叠的分类行：Privacy Traces（Skipped）、Security Projects（✓）、Useless Files（6.34 GB），展开后逐项带勾选框与"(403 files, 420.97 MB)"式统计，每项可点 **Ignore** 加入排除名单。体检评分为 10 分制"健康指数"的说法来自第三方，v7 截图中未见分数。[评测，分数部分未核实]
- **(4) 视觉**：功能型、偏密；绿色 = 执行；右栏常驻推销位。
- **(5) 付费**：Free / PRO；PRO 有实时保护、大文件管理、隐私保护等。信号：黄色升级按钮常驻右上、PRO 斜角标、标题栏 "FREE" 徽章。[图证]
- **(6) 评价**：干净利落、五个菜单就装下所有功能；竞品攻击其评分"让每台电脑都显得有病"（竞品观点，谨慎对待）。[评测] <https://www.techradar.com/reviews/wise-care-365>
- **截图**：<https://www.wisecleaner.com/templates/images/wisecare365/v7/1.png>（首页）；<https://www.wisecleaner.com/templates/images/wisecare365/v7/2.png>（结果页）；<https://www.wisecleaner.com/templates/images/wisecare365/v7/6.png>（定时任务）

### 1.11 Fortect

- **(1) 首页** [图证]：深藏蓝 + 紫色辉光。标题 "Welcome to Fortect!" + "Perform an in-depth analysis for optimal performance, robust security, and a seamless computing experience"。正中一个**电源图标的大圆环按钮**，下方文字 **START FULL SCAN**。底部三张小卡：Real-Time Protection（两个绿点状态）、Boost Performance（Start Performance Scan 链接）、成就卡 "**2,031** Items fixed for a smoother PC."。左下角账户条 "Fortect Premium — Your PC is fully protected"。
- **(2) 导航** [图证]：左侧：Dashboard / Performance / Security / Privacy / Driver Updater / VPN / Settings。
- **(3) 流程**：安装后自动扫描 → 结果摘要分六块（PC Profile 硬件信息、Crashed Programs、Malware & PUA、Junk Files、Broken Registry、Privacy Traces），页面像网页一样纵向滚动，每块有 "View & Fix"。免费版能扫不能修（或修复次数受限）。[评测，2025-09] <https://www.techradar.com/pro/fortect-review>
- **(4) 视觉**：暗色、渐变、玻璃卡片、发光环；官网营销图用巨大的数字（"We found **12,203** privacy issues"）。
- **(5) 付费**：约 $33.95 起/年；信号是把"已保护"状态做成账户徽章。
- **(6) 评价**：界面现代直观；但"免费扫描 → 发现问题 → 付费修复"正是让人起疑的模式；有测试者在全新 Win10 虚拟机上跑，结论是"结果里没有任何东西不能用免费软件轻松修好"。[评测] <https://davescomputertips.com/fortect-is-it-legit> ；<https://www.lilachbullock.com/is-fortect-legit/>
- **截图**：<https://www.fortect.com/images/home-page-new-hero-new-v1.webp> ；<https://www.fortect.com/images/home-dark-window-img-x4.png>

### 1.12 iolo System Mechanic

- **(1) 首页** [图证]：全白、极简、大字号。左侧 5 个很大的导航块：Performance（副标 "Smart ActiveCare On"）、Privacy（Upgrade）、AntiVirus（Upgrade）、Password Manager（Upgrade）、Settings。右侧面板顶部一个下拉 "Performance Home"；"Smart ActiveCare **AI** On" + 绿色开关；左半是绿色圆形对勾 + "**1976 issues have been fixed.**" + 两个按钮 CLOSE / **DEEPCLEAN**；右半是状态列：System Status **Good**、Last Scan 时间、Issues Found 0、System Recommendations 0。底部 "License — 201 Days Remaining" 和客服电话。
- **(2) 模块**：Deepclean（网络、浏览器、系统、注册表、安全、内存）、NetBooster、启动项、ActiveCare（自动后台维护）。[评测，2024] <https://www.techradar.com/reviews/iolo-system-mechanic>
- **(5) 付费**：三档 System Mechanic $39.95 / Pro $54.95 / Ultimate Defense $63.94，年付自动续费。信号：未购模块在导航里直接写 "Upgrade"。
- **(6) 评价**：界面"缺乏直觉"，功能藏在不显眼的下拉菜单里；试用要留邮箱；Trustpilot 上大量**续费 / 扣款投诉**。[评测] <https://uk.trustpilot.com/review/www.iolo.com>
- **截图**：<https://cdn.iolo.com/content/uploads/2025/03/system-mechanic-smart-activecare-ai-on-screen-shot-1000x650-1.png>

### 1.13 BleachBit（开源）

- **界面**：左侧**勾选树**（按应用分组：Deep scan、Google Chrome、Internet Explorer…，每组下是 Cache / Cookies / History 等），右侧是说明与日志；工具栏只有 **Preview** 和 **Clean**。无首页、无评分、无插画。[图证+官方] <https://www.bleachbit.org/screenshots>
- **流程**：勾选 → Preview（列出将删除的文件与预计释放空间）→ Clean → 日志显示结果。部分危险选项勾选时弹警告。[官方]
- **版本**：5.0（2025-05）；新一代 GUI 计划作为可选项推出，保留旧界面。[官方] <https://www.bleachbit.org/news/bleachbit-500> 。第三方称 2026-07 已到 6.0.2（未在官网核对）。[评测，未核实]
- **视觉**：系统原生控件，有深色主题；极高密度。
- **付费**：无。
- **评价**：被信任的原因恰恰是"透明、先预览、无推销"；被嫌弃的是不友好、要懂行。
- **截图**：<https://www.bleachbit.org/images/bleachbit320_windows10_preview.png> ；<https://docs.bleachbit.org/images/bleachbit_5_1_1_preferences_windows_11.png>

### 1.14 Dism++（初雨团队，开源）

- **界面与流程**：左侧菜单进入"空间回收" → 勾选清理项（默认只勾一部分安全项，危险项勾选时弹警告）→ **扫描** → 显示各项可回收大小 → **清理**。清理项是系统级的：被取代的 WinSxS 组件、过期驱动、过期 Appx、系统日志等。[评测] <https://sspai.com/post/41992> ；<https://www.bilibili.com/opus/782038842441990217>
- **评价**：清得深、无广告；但"选项复杂，普通用户难以判断哪些能安全清理，更像给懂 Windows 的人准备的维护工具"。[评测]
- **截图**：项目页 <https://github.com/Chuyu-Team/Dism-Multi-language>（本次未打开核对图片）[未核实]

### 1.15 WizTree / TreeSize（磁盘可视化）

- **WizTree**：直接读取 NTFS 的 MFT，所以极快；界面三件套：左上**目录树**（按大小排序、带百分比条）、右上**文件类型统计**（按扩展名着色）、下半**矩形树图（treemap）**，色块颜色对应文件类型，点击色块联动选中文件。个人免费，商用需授权。[评测] <https://alternativeto.net/software/wiztree/> ；官方 <https://diskanalyzer.com/>
- **TreeSize**：Free / Personal / Professional；除树图外还有旭日图、柱状图、重复文件、历史增长、报表导出，定位偏专业 / 企业。[官方] <https://www.jam-software.com/treesize>
- **共同惯例**：树图 + 列表联动、右键"在资源管理器中打开 / 删除"、颜色 = 文件类型的图例。这是"空间去哪了"问题的事实标准。本次未逐张查看其官方截图。[未核实截图]
- **截图页**：<https://diskanalyzer.com/> ；<https://www.jam-software.com/treesize>

### 1.16 腾讯电脑管家 18

- **版本**：18.0 于 2026-03-13 发布，主打 AI 安全（AI 沙箱"龙虾管家"、AI 应用隐私保护）。[评测] <https://www.qbitai.com/2026/03/387739.html> 。官网标语："腾讯电脑管家 更强大的 **AI 安全助手**"。[图证] <https://guanjia.qq.com/>
- **(1) 首页** [图证，官网英雄图，分辨率有限]：浅色、白 + 淡蓝紫渐变、毛玻璃卡片。左上一个**发光的 3D 玻璃球形象**（AI 助手），旁边大标题 "**定期清理加速，保障电脑性能**"，下面是 4 行带图标的待办清单。右侧是**小组件栏**：设备状态（三个百分比 / 温度数字：24%、23%、34℃）、当前网速、开机时间（15 秒）、空间清理（36.8 GB / 120 GB）、底部一排 5 个工具图标。扫描时浮出一张卡片："**智能扫描中…**" + 进度条。
- **(2) 导航** [图证]：左侧极窄的图标栏（约 6 个）；顶部有全局搜索框。官网把产品分为四块：AI 安全 / 用电脑 / AI 工具箱 / 玩游戏。
- **(3) 清理流程**：具体的扫描结果页与完成页文案本次没有找到可引用来源。**[未核实]** 行业惯例是"一键扫描 → 按类别列出可清理大小、默认只勾安全项 → 一键清理 → 完成页显示释放空间"。
- **(4) 视觉**：浅色玻璃拟态 + 3D 球体吉祥物 + 小组件；可换肤（旧版 7 套皮肤只改侧栏颜色）。[评测，2018 纯净版] <https://news.mydrivers.com/1/593/593190_all.htm>
- **(5) 付费**：本体免费；官网提到 "AI 文档限时免费" 等增值工具。会员体系细节 **[未核实]**。
- **(6) 评价**：知乎用户吐槽 18 版首页"极简过头，找个常用功能都费劲"，把它比作"取消实体按键改触摸屏"，并称内测群里普遍在吐槽。[评测，个人观点] <https://www.zhihu.com/tardis/jm/art/2023372966264619511>
- **截图**：只能在官网首页看：<https://guanjia.qq.com/>

### 1.17 360 安全卫士（14 / 极速版）与 360 清理

- **(1) 首页** [图证]：浅色。顶部一条**绿色渐变的大图标标签栏**（我的电脑 / 木马查杀 / 电脑清理 / 系统修复 / 优化加速 …）。主体左侧一个发光圆环，中间是**心电图脉冲图标**；右侧标题 "欢迎使用 360 安全卫士"、副标题 "即刻进行体检，开启安全护航"、绿色胶囊按钮 "**立即体检**"。底部一排状态入口：安全防护中心（"1 天实时守护"）、远控/勒索急救（带 Hot 角标）、**纳米 AI** 入口等。
- **(2) 模块** [官方]：安全防护 / 清理加速 / 办公提效 / 功能大全 / 软件管家。极速版把"电脑清理 + 优化加速"合并为"清理加速"，下设深度加速、深度清理、经典版清理、启动项管理。[评测] <https://news.mydrivers.com/1/894/894709.htm>
- **(3) 流程**：点"电脑清理 → 全面扫描 → 结果按分类列出、勾选 → 一键清理"。[评测，来源较弱] 体检给出 0–100 分并一键修复是 360 的招牌模式，但本次没有找到当前版本的官方文字说明。**[未核实]**
- **(4) 视觉**：绿色品牌色、渐变、光环；近年在主界面叠加 AI 对话浮窗（DeepSeek / 纳米 AI）。[图证]
- **(5) 付费**：官网宣传 "**110+ 会员权益**""永久免费使用"并存——基础免费，深度功能与去广告走会员。[图证] <https://weishi.360.cn/> 。具体哪些清理项被会员锁定 **[未核实]**
- **(6) 评价**：技术口碑不差（急救箱、查杀）；被长期诟病的是**捆绑安装、弹窗广告、主界面塞入办公 / AI / 游戏入口**；官网引用的用户评语自己都承认"广告可以设置关，就是过程麻烦"。[图证+评测]
- **"360 清理大师"**：搜索结果只指向手机版，未找到 PC 版当前信息。**[未核实]**
- **截图**：<https://p1.ssl.qhimg.com/d/inn/0499cb760608/7366.png>

### 1.18 火绒安全 6.0

- **(1) 首页** [图证]：深色（另有浅色，一键切换）。左上小字 "已保护 **21** 天"，大标题 "**火绒正在保护您的电脑**"，一个橙金色按钮 "**快速查杀**"（带下拉箭头切换全盘 / 自定义）。右侧是一幅低调的 3D 线框芯片插画（金色）。底部四个圆形小入口：检查更新 / 安全日志 / 信任区 / 隔离区。右下角版本号与病毒库日期。整屏约 15 个元素，没有任何推广位。
- **(2) 导航** [图证]：左侧纯图标栏（首页 / 防护中心 / 访问控制 / 安全工具 / 应用商店…）+ 底部设置。垃圾清理在"安全工具"里，是一个独立小工具而不是首页主角。[官方手册；具体入口位置我未在手册正文核对] <https://cdn-www.huorong.cn/Public/Uploads/uploadfile/files/20260205/火绒安全软件%206.0%20用户操作手册（6.0.9.0版本）.pdf>
- **(4) 视觉**：黑 + 金 / 橙，克制，几乎无动画；官方原则是"干净、轻巧、简单、易用"。[官方]
- **(5) 付费**：个人版免费、无会员。
- **(6) 评价**：国内口碑最好的一点就是**无弹窗、无捆绑、界面清爽**；它常被用户当作"其他管家的解药"推荐。[评测] <https://www.v2ex.com/t/549342>
- **截图**：<https://cdn-www.huorong.cn/Public/Uploads/uploadfile/images/20240729/moshiqiehuan1.gif>（明暗切换动图）；官网 <https://www.huorong.cn/person>

### 1.19 联想电脑管家 5.0

- **官网五个卖点** [图证]：设备状态（一键加速、设备优化）/ 安全防护（主动防御、深度查杀、弹窗防护）/ 原厂驱动 / 联想服务 / 应用商店。<https://guanjia.lenovo.com.cn/>
- **模块** [官方]：优化加速（开机加速、一键体检、运行加速）、垃圾清理（扫描垃圾、软件卸载）、安全中心、硬件驱动。<https://download.lenovo.com/pccbbs/pubs/x1e_p1_gen5/html/html_zh-cn/explore_lenovo_apps.html>
- **趋势**：媒体指出联想管家里塞入大量 AI 模块（智谱清言、Kimi、AI 写作），"系统清理、网络优化等基础功能只占很小一部分"。[评测，2026-05] <https://www.36kr.com/p/3828704616063234>
- 首页具体布局、扫描流程、截图：**[未核实]**（官网首页没有产品截图）。

### 1.20 华为电脑管家

- 定位是**跨设备协同**（多屏协同、华为分享、智慧搜索），"电脑优化 / 清理"只是其中一块。[官方] <https://consumer.huawei.com/cn/support/pc-manager/>
- 清理动效 [图证]：官网的 clean.gif 是白底上一个淡蓝色**风车 / 风扇叶片在同心圆轨道中旋转**，周围有小圆点绕行——极淡、极克制的扫描动画。<https://consumer.huawei.com/content/dam/huawei-cbg-site/greate-china/cn/support/pc-manager11-1/img/clean.gif>
- 首页布局与清理结果页：**[未核实]**
- 付费：免费，随机预装。

### 1.21 鲁大师

- **定位**：硬件检测 / 跑分为主，清理优化为辅。当前版本 6.1026（2026-11-24 更新）。官网导航里有"**尊享会员**"和"精选游戏"。[图证] <https://www.ludashi.com/>
- **首页**（官网示意图，线框化）[图证]：蓝色左侧栏（顶部老头形象头像 + 7 个导航项）+ 白色内容区，英雄元素是一个**绿色圆环进度 / 评分环** + 标题 + 绿色按钮。<https://cdn-img.ludashi.com/a/202103/26/605dcd7ee4a95.png>
- **评价**：2025-11 火绒发布报告，指控鲁大师利用弹窗推广页游、未经许可弹窗安装第三方软件、后台篡改京东链接插入返佣参数。[评测] <https://news.qq.com/rain/a/20251112A02VAQ00> 。用户普遍反映广告弹窗与后台占用。
- 清理流程细节：**[未核实]**

### 1.22 金山毒霸（含青春版）

- **官网** [图证]：主推"毒霸青春版"——"安全 智能 快速"，卖点是蓝芯 V 云引擎、安全雷达、铠甲防御、"10s 安装"。官网导航有"**会员中心**"。配图是等距 3D 发光图标（云、盾、雷达）。<https://www.duba.net/>
- **模块**：全面扫描、垃圾清理、电脑加速、软件管家、C 盘瘦身专家等。[评测，下载站，较弱]
- **评价**：黑猫投诉有"硬要收费、一再弹窗收费、自带各种广告"的投诉；V2EX 用户吐槽"热点新闻"弹窗没有关闭按钮。[评测] <https://tousu.sina.com.cn/complaint/view/17375043277/> ；<https://www.v2ex.com/t/549342>
- 首页布局、清理流程、哪些功能被会员锁：**[未核实]**

### 1.23 其他值得一提

- **Windows 自带"存储感知 / 清理建议"**：这是所有清理软件的隐形基准线——用户会拿你和系统设置比。PC Manager 的 Storage 页直接集成了 Storage sense 入口。[图证]
- **Privacy Eraser、小番茄 C 盘清理**：在中文横评里出现，但文章带明显推广性质，数据无出处。[评测，可信度低] <https://gitcode.csdn.net/6aa0dfa91a35784c84209181.html>
- "获奖"产品：本次没有找到针对 Windows 清理软件 UI 的设计类奖项（红点 / iF 等）记录。**[未核实]**

---

## 2. 综合：这个品类的用户心智模型

### 2.1 首页的"必备件"

把 20 多个产品的首页叠在一起，重复出现的元素如下（括号内是我看到图证的产品）：

| 元素 | 出现在 | 说明 |
|---|---|---|
| **一个压倒性的主操作** | CCleaner、ASC、Fortect、Wise、360、火绒、PC Manager | 一屏只有一个主按钮：Scan / Checkup / Boost / 立即体检 / 快速查杀 |
| **一句"现在是什么状态"的话** | 全部 | 未扫描："Run your first scan""Running Slow? Check Up Now!"；已扫描："Your scan results"；健康："火绒正在保护您的电脑" |
| **可量化的数字** | PC Manager（64% / 1.8GB）、腾讯（36.8/120 GB）、AVG（12.6 GB）、Glary（28 s）、Fortect（2,031） | 用户要看到"多少"，而不是"有问题" |
| **上次扫描时间 + 重新扫描** | AVG、Avast、PC Manager、iolo | "Last scan: 2 days ago" + Rescan |
| **累计成果** | AVG、Avast、Fortect、iolo | "到目前为止你清了 21.6 GB"——证明软件的价值 |
| **常驻的模块导航** | 全部 | 左侧栏（多数）或顶部大图标栏（360、Wise） |
| **自动 / 定时开关** | Wise、Glary、iolo、PC Manager | 首页就能开"定期清理" |

首页有两种主流范式，要先选一种：

- **A. 行动号召型**：大按钮 + 一句话（CCleaner、ASC、Fortect、Wise、360）。第一次打开时最好。
- **B. 结果仪表盘型**：打开就是上次扫描的结果卡片，每张卡片可单独处理（AVG、Avast、WinOptimizer、PC Manager、腾讯 18）。老用户每天看的是这个。

成熟产品其实是 **A → B 的状态机**：首次是 A，扫描过之后首页变成 B。

### 2.2 用户默认期待的模块

按"出现频率"排序（括号是有该模块的产品数量级）：

1. **垃圾清理**（系统临时文件、浏览器缓存、回收站、日志）——全部
2. **启动项 / 开机加速**——几乎全部
3. **软件卸载**（含批量、残留清理）——几乎全部
4. **隐私痕迹清理**（浏览记录、Cookie）——几乎全部
5. **大文件 / 磁盘占用分析**——CCleaner、PC Manager、Wise、ASC 20、TreeSize 系
6. **重复文件**——CCleaner 7、ASC 20、Wise、Glary
7. **内存释放 / 一键加速**——PC Manager、ASC、Wise、国产全部
8. **软件更新 / 驱动更新**——CCleaner Pro、ASC Pro、Avast、Fortect、联想
9. **定时 / 自动清理**——多数放在付费层
10. **体检 / 健康检查**（把以上串成一键）——CCleaner、PC Manager、Wise、360、联想
11. **文件粉碎**、**注册表清理**、**右键菜单管理**、**弹窗拦截**（国产 + PC Manager 特有）
12. 国产特有：**微信 / QQ 专清、C 盘瘦身 / 搬家**（来源较弱，但在中文横评里反复被提及）

### 2.3 扫描 → 清理的标准流程

这是品类里最稳定的一条惯例，偏离它用户会不安：

1. **起点**：一个按钮。文案强调"不会不经询问就删东西"（CCleaner 原话）。
2. **扫描中**：一个持续运动的环形或进度条 + **当前正在扫什么的小字**（"Scanning for junk files…"）+ 分类清单逐项从 "Scanning…" 变成结果 + **可取消**。（PC Manager、WinOptimizer、腾讯）
3. **结果页**：
   - 顶部一行摘要：**总大小是最大的字**（"6.34 GB"），辅以项目数、耗时。（Wise）
   - 下面按**类别**分组，每组显示大小，可展开看到具体条目；每条有勾选框。（Wise、PC Manager、BleachBit、Dism++）
   - **默认只勾安全项**，有风险的不勾并附说明或警告。（Dism++、BleachBit、PC Manager 的 ⓘ）
   - 可以**忽略 / 加入排除名单**。（Wise 的 Ignore）
   - 可以先**看明细再清**：SEE DATA / Review / Preview。（AVG、Avast、BleachBit）
   - 主按钮只有一个：Fix / Clean now / 一键清理。
4. **清理中**：同一位置的进度，逐类别打勾。
5. **完成页**：绿色对勾 + **释放了多少**（"Freed 17.0 MB of drive space"，数字加粗着色）+ 逐项 "Cleaned" 清单 + Done。（PC Manager）成果计入累计统计。（AVG、Avast）
6. **后悔药**：回收站选项（CCleaner 7）、Undo Center（Avast）。

### 2.4 "高级感"从哪里来

对比看图后的归纳：

- **一屏一个重点**。ASC、Fortect、CCleaner 7、火绒的首页元素都在 15 个上下；WinOptimizer、Glary、Wise 在 25 个以上，观感立刻"工具化"。
- **颜色有纪律**：一个品牌色做主操作；**绿色 = 执行 / 完成**；**橙 / 黄 = 待处理的量或升级**；红色几乎不用。AVG、Avast、Wise、CCleaner 都遵守这套语义。
- **数字是排版的主角**：大号、加粗、着色的 GB 数，周围留白。
- **一个有记忆点的中心物件**：ASC 的发光扫描环、Fortect 的电源环、腾讯的玻璃球、360 的脉冲环、华为的风车。它同时充当"按钮 → 进度 → 结果"三种状态的载体。
- **暗色 + 辉光**是付费海外产品的主流（ASC、Fortect、AVG、Avast、WinOptimizer）；**浅色 + 毛玻璃 / Fluent** 是系统系与国产新版的主流（PC Manager、腾讯 18、华为、联想）。两条路都成立，但不要混。
- **插画要成体系**：CCleaner 7 每个模块一幅同风格扁平插画；火绒一幅低调 3D。零散的图标堆砌不算。
- **把"已付费"做成身份而不是广告**：Fortect 的 "Premium — Your PC is fully protected" 账户条、iolo 的 "License 201 Days Remaining"。付费用户界面里**不再出现升级按钮**。
- **证明价值**：累计清理统计、图表（Avast 的月度面积图）。
- **解释与克制**：ⓘ 说明、"不会不经询问就清理"、先预览。信任感本身就是高级感。

### 2.5 付费层的通行做法

| 做法 | 例子 |
|---|---|
| 免费给"手动清理"，付费卖"**自动 / 定时 / 实时**" | ASC（一键释放内存 vs 自动）、Glary、CCleaner、Wise |
| 免费给"空间"，付费卖"**速度 / 安全 / 更新**" | CCleaner Health Check：Privacy + Space 免费，Speed + Security 付费 |
| 付费卖"**深度**" | ASC "Deep clean hidden junk"、Glary deep cleaning |
| 付费卖**周边工具** | 驱动更新、软件更新、云盘清理、数据恢复、VPN、杀毒 |
| 视觉信号 | 专用的**黄 / 橙色**（CCleaner、Wise、Glary、ASC）；PRO 小角标；标题栏 FREE / PRO 徽章；导航项下直接写 "Upgrade"（iolo） |
| 纯订阅、无免费版 | AVG、Avast、Norton、Fortect（免费只能扫） |

---

## 3. 反模式（要避开的）

1. **夸大的问题计数**。"发现 12,203 个隐私问题"这种数字（Fortect 营销图、Avast 的 12,569 注册表项）会让懂行的人立刻归类为 scareware。安全研究者记录过"报 9,828 个注册表问题、实际什么都不删"的假清理软件；Malwarebytes 把注册表清理称为 "digital snake oil"；微软明确不支持注册表清理工具，并把"恐吓用户付费"的清理 / 优化软件归为不受欢迎软件。[评测] <https://www.malwarebytes.com/blog/news/2015/06/digital-snake-oil> ；<https://betanews.com/2016/11/07/clean-pc-smart-fake-registry-cleaner/> ；微软 Defender 团队文章（本次打开超时，未读到原文）[未核实原文] <https://techcommunity.microsoft.com/t5/Microsoft-Defender-ATP/Protecting-customers-from-being-intimidated-into-making-an/ba-p/151261>
2. **免费扫描、付费才能修**。Fortect 模式，评测者的第一反应就是怀疑。
3. **把系统描述成"病了"**。"Your PC feels under the weather"、满屏红色、低分恐吓。
4. **常驻推销位与通知轰炸**。IObit 的持续 Pro 提示与自家产品安装器、Avast 的"通知太多"、Wise 的右栏、CCleaner 首页底部的 "programs slowing down" 横幅。
5. **捆绑安装、弹窗广告、塞入无关业务**（游戏、资讯、AI 办公、应用商店）。360、鲁大师、金山毒霸、联想的主要差评来源；火绒的全部好评来源。
6. **极简过头，把老用户的功能藏起来**。CCleaner 7（启动项"藏得很深"、设置多点好几次、Cookie 名单丢失）与腾讯 18（"找个常用功能都费劲"）是同一种错误：视觉变干净了，但专业用户失去了控制感。
7. **合并不该合并的东西**。CCleaner 7 把注册表清理并入日常 Custom Clean——高风险操作不应搭便车。
8. **窗口不可缩放 / 尺寸失控**。CCleaner 7 在小屏上按钮够不到；AVG Mac 版窗口不能调整大小被点名。
9. **续费与扣款不透明**。iolo 在 Trustpilot 上的主要差评。首年价与续费价差距大（AVG $29.99 → $69.99）要说清楚。
10. **只有"一键"没有"明细"**，或只有"明细"没有"一键"。前者不被信任（360"强力清理可能误删"），后者不被普通人使用（Dism++、BleachBit）。

---

## 4. 对新设计的 10 条具体建议

1. **首页做成"状态机"而不是一张静态图**：未扫描 = 中心物件 + 一句话 + 一个按钮（范式 A）；扫描过 = 同一位置变成"可释放 X GB"的结果摘要 + 分类卡片（范式 B）；清理后 = "已释放 X GB · 上次清理 2 天前"。三种状态共用同一个中心物件。
2. **设计一个品牌化的中心物件**（环 / 球 / 自家吉祥物的"拖把"都行），让它承担 待机 → 扫描动画 → 进度 → 完成对勾 四种形态。这是客户所说"像清理软件"的最大来源：ASC、Fortect、360、腾讯、华为无一例外。
3. **数字优先**：首页必须出现至少一个真实的量——C 盘已用 / 总量、可释放大小、上次清理释放量。字号要大，单位用 GB / MB，不要用"N 个问题"做主指标。
4. **扫描过程要"看得见在干活"**：进度环 + 当前路径或类别的滚动小字 + 分类清单逐项出结果 + 取消按钮。不要只放一个不确定进度的转圈。
5. **结果页按"类别 → 条目"两级展开，默认只勾安全项**；每个类别显示大小和一句人话解释；有风险的类别默认不勾、用中性色标注"需确认"并给 ⓘ 说明；提供"忽略 / 排除"。主按钮文案带上数字："清理 6.3 GB"。
6. **完成页要有仪式感但不夸张**：对勾动画 + 释放量大数字 + 逐项"已清理"清单 + 一个 Done；把成果写进"累计已清理"统计，并在首页长期展示（AVG / Avast 的做法）。
7. **导航用左侧栏，8 项以内，命名用用户的词**：首页（体检）/ 垃圾清理 / 大文件 / 重复文件 / 软件卸载 / 启动项 / 隐私清理 / 工具箱。其余进工具箱。不要像 CCleaner 7 那样把高频功能降级，也不要像 WinOptimizer 那样摆出 30 个模块。
8. **同时服务两类人**：默认是一键流程；但每一步都能"查看明细 / 自定义"（Custom Clean、SEE DATA、Preview）。给专业用户保留排除名单、回收站而非直接删除、定时任务——这些是 CCleaner 老用户因为失去而愤怒的东西。
9. **付费信号用一个专属的暖色，并且只在三处出现**：导航底部的升级入口、被锁功能上的小角标、功能页内的一次性说明。付费用户界面里把升级入口换成"Premium · 有效期至…"的身份条。付费点优先放在**自动化（定时 / 实时 / 后台）与深度**，不要锁"扫描结果能不能修"。
10. **把"克制"当卖点写进界面**：文案明说"不会未经确认删除任何文件"；不用红色警告与恐吓式措辞；不做注册表问题计数；不放任何第三方推广位；窗口可缩放并在 1366×768 下完整可用。国内对标火绒与微软电脑管家的"干净"，海外对标 PC Manager 的 Fluent 质感与 Avast / AVG 的结果卡片结构。

---

## 5. 截图索引（可直接打开）

| 产品 | 画面 | URL |
|---|---|---|
| CCleaner 7 | 首页 Health Check | <https://www.free-codecs.com/guides/pictures/CCleaner-7-Run.png> |
| CCleaner 7 | 欢迎页（插画风格） | <https://www.free-codecs.com/guides/pictures/CCleaner-7-Welcome_1.png> |
| Microsoft PC Manager | 首页 Boost | <https://pcmimage.officeplus.cn/images/enusSystemAccelerationNew.webp> |
| Microsoft PC Manager | 体检扫描中 + 完成 | <https://pcmimage.officeplus.cn/images/enusPhysicalExaminationNew.webp> |
| Microsoft PC Manager | 存储页 + 清理完成清单 | <https://pcmimage.officeplus.cn/images/enusSystemSpace.webp> |
| Microsoft PC Manager | 工具箱 | <https://pcmimage.officeplus.cn/images/enusToolbox.webp> |
| IObit ASC 20 Pro | 首页 SCAN 环 | <https://www.iobit.com/tpl/images/2025/product_pro/pro_pic.png> |
| Ashampoo WinOptimizer 29 | 分析仪表盘 | <https://img.ashampoo.com/ashampoo.com_images/img/1/products/7306/website-ashampoo-winoptimizer-29-render-front.png> |
| AVG TuneUp | 结果卡片首页 | <https://static2.avg.com/10005055/web/i/page/avg-pctuneup-v2/ui1.png> |
| AVG TuneUp | 磁盘清理 | <https://static2.avg.com/10005055/web/i/page/avg-pctuneup-v2/ui5.png> |
| Avast Cleanup Premium | 结果 + 累计统计图 | <https://www.avast.com/content/dam/avast/ui-screens/bait/ui-cleanup-pc-bait-01-A1.png> |
| Glary Utilities 6 | Overview | <https://www.glarysoft.com/images/softbox/gu6-free.png?20231121> |
| Wise Care 365 v7 | 首页 Checkup | <https://www.wisecleaner.com/templates/images/wisecare365/v7/1.png> |
| Wise Care 365 v7 | 扫描结果页 | <https://www.wisecleaner.com/templates/images/wisecare365/v7/2.png> |
| Fortect | 首页 | <https://www.fortect.com/images/home-page-new-hero-new-v1.webp> |
| iolo System Mechanic | 完成 / 状态页 | <https://cdn.iolo.com/content/uploads/2025/03/system-mechanic-smart-activecare-ai-on-screen-shot-1000x650-1.png> |
| BleachBit | 预览界面 | <https://www.bleachbit.org/images/bleachbit320_windows10_preview.png> |
| 腾讯电脑管家 18 | 官网英雄图（首页 + 扫描卡片） | <https://guanjia.qq.com/> |
| 360 安全卫士 | 首页 立即体检 | <https://p1.ssl.qhimg.com/d/inn/0499cb760608/7366.png> |
| 火绒 6.0 | 首页明暗切换动图 | <https://cdn-www.huorong.cn/Public/Uploads/uploadfile/images/20240729/moshiqiehuan1.gif> |
| 华为电脑管家 | 清理动效 | <https://consumer.huawei.com/content/dam/huawei-cbg-site/greate-china/cn/support/pc-manager11-1/img/clean.gif> |
| 鲁大师 | 官网界面示意 | <https://cdn-img.ludashi.com/a/202103/26/605dcd7ee4a95.png> |
| TechRadar 图库 | Fortect 实拍 | <https://cdn.mos.cms.futurecdn.net/GJxN2ctHEVxBdNGY9h2Czf.png> |
| TechRadar 图库 | WinOptimizer 扫描结果（旧版） | <https://cdn.mos.cms.futurecdn.net/WriFRVA9GRpPQJcxGvsyYL.jpg> |

## 6. 本次调研的缺口

- 未实际安装任何软件，所有"扫描动画""完成页"的动态效果只能从静态截图与文字推断。
- 国产软件（腾讯、360、联想、华为、鲁大师、金山毒霸）的**清理结果页与完成页**没有找到可引用的当前版本官方截图；相关段落已标 [未核实]。建议在虚拟机里各装一遍录屏补齐。
- Norton Utilities Ultimate、Dism++、WizTree、TreeSize 的界面截图本次没有逐张查看。
- 多家英文评测偏旧（TechRadar 的 IObit / Ashampoo 评测是 2020 年，Avast 是 2022 年），已在各条注明。
- 许多站点（betanews、pcwelt、windowsforum、windowsreport、ithome）拒绝抓取，只用到了搜索摘要。
- 价格均为调研当日官网显示的促销价，会变动。
