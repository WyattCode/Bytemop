# Mac 清理 / 维护类应用 UI 调研（2025–2026）

> 调研日期：2026-11-25。方法：仅网页检索与页面阅读，未下载、未安装、未注册任何软件。
> 可信度标注：
> - **[已核实-图]**：我在浏览器中直接打开了官方/媒体截图并目视确认。
> - **[已核实-文]**：来自官方页面或媒体评测的文字。
> - **[背景知识]**：来自我已有的知识，本次未能找到可引用的页面佐证，请自行核对。
> - **[未能核实]**：本次没有查到或页面无法访问。
>
> 注意：我没有实际运行任何应用，所以**动效、声音、扫描过程中的动画细节基本都无法直接核实**，凡涉及处均已标注。

---

## 0. 结论先行（给赶时间的人）

1. CleanMyMac（2024-10 重设计，现 5.5.x）定义了这个品类的“高级感”模板：**一屏只讲一件事**——左侧窄导航、中间一个巨大的 3D 玻璃质感物体、右侧标题 + 一句话 + 三条要点、底部正中一个圆形 Scan 按钮。没有表格、没有数字仪表盘、没有文件列表。
2. 结果页不是文件列表而是 **5 块磁贴**：每块只有“一个大数字 + 一个动词短语 + 一个 Review 小按钮”，底部一个圆形 **Run**。文件列表被藏到第二层（“Cleanup Manager”三栏视图）。
3. **颜色即导航**：每个模块整窗换一种渐变底色（Smart Care 紫、Cleanup 绿、Protection 洋红、My Clutter 青绿、Cloud Cleanup 蓝）。
4. 品类里存在两条“高级”路线：**CleanMyMac 式（情绪化、3D、渐变、动效）**与 **DaisyDisk / Sensei / 系统设置式（克制、原生、数据可视化本身就是主视觉）**。两者共同点是“少”和“信任”，而不是“炫”。
5. 反面教材是 MacKeeper：常驻升级按钮、常驻客服聊天面板、扫描中弹窗、“Activate and Fix”是结果页最大的按钮——评测一致批评。

---

## 1. CleanMyMac（MacPaw）——品类标杆

**版本现状**：2024-10-16 发布重设计版，去掉名称里的“X”，MacPaw CEO 称“the most significant change we've made in the last six years”。官网现显示 5.5.7（2026-07-22），标语为 “Smart & effortless Mac care”。[已核实-文]
来源：https://macpaw.com/cleanmymac ｜ https://9to5mac.com/2024/10/16/macpaw-releases-major-update-to-cleanmymac-with-fresh-design-and-new-features ｜ https://www.macstories.net/reviews/macpaw-updates-cleanmymac-with-a-fresh-design-and-new-tools/

### 1.1 首页（Smart Care 欢迎屏）[已核实-图]

截图：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/810a3ee0-df6f-4b3b-9af6-20ddbdd02896.webp

- **整窗是一张深紫 → 洋红 → 靛蓝的大渐变**，窗口大圆角，没有标题栏分隔线，交通灯按钮直接浮在渐变上。
- **左侧导航**约占窗宽 20%，每项是“小 3D 图标 + 文字”，选中项是一块半透明圆角胶囊。分三组，组间留白很大。
- **主视觉**：一台粉紫色玻璃质感的 3D iMac，屏幕上搭着一把雨刷/刮板，约占窗宽 30%，位于内容区中偏左。物体有高光、厚度和柔和投影，是“渲染的 3D 物件”而不是扁平插画。
- **右侧文字**只有：大标题 “Smart Care”（细体，约 28–32pt 观感）、一句副标题 “Quick maintenance that takes care of the essentials.”、三条带小图标的要点：Quick Scan / System Tune-up / Security Check。
- **唯一的操作**：底部正中一个**圆形 “Scan” 按钮**，骑在窗口下边缘上，背后有彩色辉光。右下角极小的 “by MacPaw”。
- 整屏可交互元素：导航 10 项 + 1 个按钮。**没有任何数字、进度条、磁盘占用图。**

官方步骤文案：进入 Smart Care → 点 **Scan** → 查看结果 → 点 **Run**；“CleanMyMac won't delete user files or app data unless you choose to”。[已核实-文]
来源：https://macpaw.com/support/cleanmymac/knowledgebase/smart-care

### 1.2 导航与模块 [已核实-图 + 文]

当前侧栏（2026 截图）：**Smart Care / Cleanup / Protection / Performance / Applications / My Clutter / Space Lens / Cloud Cleanup**，下方另一组 **My Tools / My Activity**。2024 年发布时是 6 个模块 + 左下角 **Assistant**（Space Lens 在 5.0 被拿掉，后来加回；Cloud Cleanup 于 2025-07-29 上线且需要 Plus 套餐）。
帮助中心还列出 Email cleanup、Browser Care、“Delete AI clutter” 等更新的功能。
来源：https://macpaw.com/support/cleanmymac/knowledgebase/concepts-and-usage ｜ https://thesweetbits.com/tools/cleanmymac/ ｜ https://tidbits.com/watchlist/cleanmymac-5-0/

关键行为：**进入结果页后侧栏自动收成只有图标的窄条**（约窗宽 6%），当前模块图标右上角带一个小圆点徽标，把空间让给内容。[已核实-图]

各模块职责（官方）：
- Smart Care：一次跑 5 件事——Cleanup（系统垃圾/邮件附件/废纸篓）、Protection（快速恶意软件扫描）、Performance（维护脚本 + Flush DNS）、Applications（应用更新）、My Clutter（Downloads 里的重复文件）。
- Cleanup：系统垃圾、缓存、日志、Universal Binaries、语言文件、Xcode 垃圾、文档版本、邮件附件、废纸篓。
- Protection：Moonlock 引擎查杀 + 应用权限（摄像头/麦克风）管理，Quick / Balanced / Deep 三档。
- Performance：登录项、后台项、维护任务。
- Applications：卸载（含残留）、更新、未使用应用。
- My Clutter：大文件/旧文件、重复文件、相似图片、下载。
- Space Lens：左列表 + 右“气泡图”。

### 1.3 扫描 → 清理流程

1. **欢迎屏点 Scan。**
2. **扫描中**：评测只说“几秒到两三分钟”（一处测得 Smart Care 约 3 分 7 秒；My Clutter 在 4TB 机器上约 25 分钟）。扫描动画的具体形态 **[未能核实]**；5.0.7 起新增 **Reduce Motion** 选项“减少扫描时的动画和视觉效果”，侧面说明默认动效很重。来源：https://www.macworld.com/article/352922/cleanmymac-x-review-macos.html
3. **结果页**（Smart Care）[已核实-图]
   截图：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/7c6d9bf8-a545-4353-8d34-61b8070af7f9.webp
   - 顶部一句话：**“Your tasks are ready to run. Look what we found:”**
   - 3 + 2 排列的 5 块半透明磁贴。每块：左上角复选框 + 模块名（Protection 还写 “by Moonlock”）；右上角是该模块的 3D 物体，**故意被磁贴边缘裁掉一半**；中下部一个大数字短语 + 一行小字：
     - “8,2 GB of junk / to clean”
     - “1 threat / to remove”
     - “2 tasks / to run”
     - “No vital updates / to install”（无事可做的磁贴没有复选框和按钮）
     - “44 duplicate downloads / to remove”
   - 每块右下角一个很小的灰色 **Review** 按钮。
   - 底部正中圆形 **Run**；左上角 “Start Over”。
   - 默认全选；取消勾选即跳过；设置里排除的模块其磁贴变暗并显示 Enable。
4. **Review 第二层**（Cleanup Manager）[已核实-图]
   截图：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/f296b094-6321-4b20-b995-a16b07b456ae.webp
   - 变成**白底三栏**：大类（System Junk / Mail Attachments / Trash Bins）→ 子类（User Cache Files 7 GB、Universal Binaries 1,7 GB、Xcode Junk…，每项带彩色图标和粉色容量徽标）→ 具体条目（复选框 + 图标 + 名称 + 大小 + 展开箭头）。
   - 子类顶部有一段**人话解释**（“Originally intended to improve startup times, the cache files…”）。
   - 底部固定条：“1029 Items Selected | 7,5 GB” + 粉色 **Done**。右上角搜索与 “Sort by: Size”。
   - 即：**首层是情绪化的彩色玻璃，第二层回到朴素的原生列表**，深浅对比本身就在传达“这里是认真干活的地方”。
5. **单模块结果页**（Cleanup）[已核实-图]
   截图：https://9to5mac.com/wp-content/uploads/sites/6/2024/10/Screenshot-2024-10-16-at-9.28.57%E2%80%AFAM.png?w=1024
   - 整窗换成绿色渐变；标题 “There are 5 GB of junk files on your Mac.” + 一个 “Review All Junk” 按钮；一块大磁贴（“4.7 GB of System Junk Found”）+ 四块小磁贴，每块有 **Review** 和白色 **Clean** 两个按钮。
   - Macworld：结果以摘要磁贴而非长列表呈现，“far less confusing”。
6. **完成页** [已核实-图]
   截图：https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=640,dpr=2/images/content/image_1779975289.png
   - 一块大的磨砂玻璃面板，左侧 3D 物体**压在面板边缘之外**；右侧 “**Cleanup complete!**”、“19,2 GB of Junk / successfully cleaned”；左下 “View Log”，右下白色 “Done”。
   - 只有一个数字。没有烟花式的满屏统计。
7. **安全措辞**：Ignore list（忽略列表）、Safety Database、默认不动用户文件；My Clutter 的文案是 “Use quick recommendations or review them by hand”。撤销机制：**[未能核实]** CleanMyMac 是否提供清理后的撤销（姊妹产品 Gemini 2 明确是“移到废纸篓，一键恢复”）。

### 1.4 视觉风格细节 [已核实-图，动效/声音除外]

- **色彩**：每个模块一套整窗渐变——Smart Care 紫/洋红/靛蓝；Cleanup 深绿到草绿；Protection 洋红/玫红；My Clutter 青绿；Cloud Cleanup 钴蓝；Assistant 紫；Performance 的磁贴物体是橙色（整窗底色未见截图，**[未能核实]**）。渐变是大范围、低频、带“光斑”的，不是线性两色条。
- **3D 物体**：每个模块一个“圆润、厚玻璃、带内部物件”的渲染物（绿色圆盘、粉色举手、橙色闪电盾、蓝色应用图标、青色文件夹、蓝色云朵）。同一个物体在三处复用：侧栏小图标 → 欢迎屏主视觉 → 结果磁贴右上角裁切。
- **玻璃**：磁贴和完成面板都是半透明磨砂，边缘有 1px 亮边，圆角约 12–16px 观感。
- **按钮**：主操作是**圆形**、带辉光、位于底部正中；次级按钮是很小的灰色胶囊。全应用只有一个主按钮形态。
- **字体**：标题细体大字，数字与单位同字号（“8,2 GB of junk”整句一个字号），说明小字降一档透明度。
- **菜单栏应用** [已核实-图]：https://cdn.macstories.net/cleanshot-2024-10-16-at-11-55-43-2x-1729094287726.png
  - 顶部 “Mac Health: Fair” + 机型小 3D 图；下面是磁贴网格：Protection by Moonlock（“Real-time malware monitor ON”）、Macintosh HD（Available: 1.01 TB，**Free Up**）、Memory（Pressure: 25%，**Free Up**）、CPU（温度/负载）、网络（上下行，**Test Speed**）、Connected Devices（电量）；底部 “Today's Recommendation” 一张卡片 + 一个按钮（“Update My Applications”）。
- **Assistant** [已核实-图]：https://9to5mac.com/wp-content/uploads/sites/6/2024/10/Screenshot-2024-10-16-at-9.12.07%E2%80%AFAM.png?w=1024
  - 左：发光圆环里放着一台 3D MacBook，“Mac Health: Excellent”；右：三张建议卡，每张一个按钮。
- **Space Lens** [已核实-图]：https://b2c-contenthub.com/wp-content/uploads/2025/10/Space-Lens.jpg —— 左侧可勾选的文件夹列表，右侧大小不等的玻璃气泡，悬停出信息卡，底部 “4 items selected | 13.9 MB” + 粉色 “Review and Remove”。
- **动效 / 声音**：MacPaw 2021 年（CleanMyMac X 时代）自述使用 “parallax animations, hover effects, and ambient sounds”，图标是“glass-like”。iF Design 条目称新版是 “3D animated interface”。新版具体声音设计 **[未能核实]**。来源：https://macpaw.com/news/cleanmymac-received-ux-design-awards ｜ https://ifdesign.com/en/winner-ranking/project/cleanmymac-by-macpaw/767264（页面 403，仅见检索摘要）
- **深/浅色**：首层永远是深色渐变（不随系统变浅）；第二层管理器是浅色面板。是否有完整浅色主题 **[未能核实]**。
- **无障碍**：5.0.7 加入 Reduce Motion 与 VoiceOver 支持。

### 1.5 付费与“高级”的表达 [已核实-文]

- 官网：“Starting at $3.33/month”。评测口径：Basic 约 $9.95/月、$39.95–47.50/年、一次性 $119.95；**Plus**（含 Cloud Cleanup 等）$15.95/月、约 $71.40/年、一次性 $195.95；按 1/2/5 台计价；7 天试用，30 天退款。也在 Setapp 订阅内。
- 高级感不是靠“PRO 徽章”堆出来的：界面里几乎看不到锁和升级横幅；靠的是工业设计奖（Red Dot、iF、UX Design Awards）、Apple 公证、“by MacPaw / by Moonlock” 这类署名。
- 来源：https://www.macworld.com/article/352922/cleanmymac-x-review-macos.html ｜ https://thesweetbits.com/tools/cleanmymac/

### 1.6 口碑 [已核实-文]

- 赞：Macworld Editors' Choice，“bright, friendly user interface”；磁贴让结果“不再令人困惑”；MacStories：模块被“大幅简化并用更平白的语言解释”；UX Design Awards 评委：“giving just the right amount of visual feedback and information at the right time, it creates trust”。
- 弹：TidBITS 读者：“Lots of graphics, colors and animation that I personally find distracting and annoying”；涨价 + 订阅；恶意软件模块无法单独不买；MacRumors 论坛大量“清理软件根本没必要 / 近似恶意软件”的不信任声音；有人称被删掉了需要的语言文件。
- 来源：https://tidbits.com/watchlist/cleanmymac-5-0/ ｜ https://forums.macrumors.com/threads/macpaw-releases-redesigned-cleanmymac-with-new-features.2440216/

---

## 2. MacKeeper（Clario Tech）——功能全、口碑差的对照组

- **版本**：7.x（7.8，2026-09）。官网标语 “Your all-in-one Mac maintenance app”，“Access all MacKeeper tools from one simple dashboard”。$10.95/月起。[已核实-文] https://mackeeper.com/
- **首页 / 导航** [已核实-文，应用内截图未能看到]：侧栏顶部 **Find & Fix** 与 **Premium Services**，下面四组 Security / Cleaning / Performance / Privacy 共 11 个工具（Antivirus、Adware Cleaner、Safe Cleanup、Duplicates Finder、Smart Uninstaller、Memory Cleaner、Login Items、Update Tracker、VPN、StopAd、ID Theft Guard 等）。免费版侧栏**常驻绿色 “Unlock Full Version” 按钮**；几乎每屏右侧有 “Welcome to the MacKeeper chat!” 客服面板。
- **流程**：Find & Fix 一键跑四组 → 结果页列出各项状态（垃圾 5.6 GB、身份保护关闭、16 项性能建议、171 个重复…）→ 最大的按钮是 **“Activate and Fix”**；免费版每个工具只能修一次。
- **视觉**：官网是浅色、蓝色主按钮、卡通吉祥物（拿水枪冲病毒的小人）；应用内配色与动效 **[未能核实]**。
- **付费信号**：1 台 12 个月首年 $71.40、续费 $95.40；划线价、离开页面再打 9 折；Premium Services 是人工远程支持（PCMag 2025 年称 $696/年，“disproportionately expensive”）。
- **口碑**：赞“清晰简单、扫描快、24/7 真人客服”；批评集中在**打断式升级提示、扫描中弹出数据泄露检查、聊天面板等于常驻推销**；历史上以“虚报问题吓人付费”闻名；Malwarebytes 仍将其标为 PUP（据 Nektony）。
- 来源：https://nektony.com/reviews/mackeeper ｜ https://www.wizcase.com/antivirus/mackeeper/
- 截图页面：https://mackeeper.com/ （首页含产品动画 https://static-cdn.mackeeper.com/mk-site/animation/index/hero-homepage-new/hero-video-bl-new.mp4 ，我未播放）

---

## 3. DaisyDisk——“一张图就是全部界面”

- **版本 / 价格**：4.34.2（2026-07-10）；**$9.99 一次性买断**，最多 5 台；App Store Editors' Choice，三次“年度最佳”。[已核实-文] https://daisydiskapp.com/
- **首页**：磁盘列表，每块盘一条容量条和 **Scan** 按钮；“Green color means at least half of your disk is empty, red is often a clear call to action”。来源：https://daisydiskapp.com/guide/4/en/DisksOverview/
- **主界面** [已核实-图]：https://daisydiskapp.com/img/home/intro-ss1.png ｜ https://daisydiskapp.com/img/home/intro-ss2.png
  - **深蓝灰底**（约 #2A3550 观感），左侧一朵多彩**旭日图（sunburst）**，中心写总容量；右侧只是一个“彩色圆点 + 名称 + 大小”的纯文字列表；顶部面包屑。
  - 左下角圆形“收集器”显示 “10.9 GB collected”，旁边一个红色 **Delete**。
  - 调色板：薄荷绿、青、紫、珊瑚粉、黄绿——低饱和度的糖果色放在深底上。
- **流程**：Scan（SSD 几秒）→ 悬停看详情、点击下钻 → 空格预览 → 把文件拖进左下收集器 → Delete。删除带倒计时可取消、且为永久删除 **[背景知识]**（官网只确认 “Files deleted permanently”、“System files are automatically safeguarded”）。
- **立场文案**值得注意：“macOS can clean itself very well, and Apple actually discourages the use of cleaner apps… fix the real problem — find and delete the large files that you no longer need.”
- **口碑**：The Verge “neat, colorful rings”；官网自述 “minimalist design and thought-out interactions… an easy and fun experience”。
- 演示视频：https://youtu.be/BKClylmlv3w

---

## 4. Sensei（Cindori）——原生深色、仪表盘派

- **价格**：订阅 $29/年 或 一次性 $59，均覆盖 3 台 Mac。[已核实-文] https://cindori.com/store/sensei
- **导航** [已核实-图]：侧栏 Dashboard / Monitor；**Utilities**：Optimize、Uninstaller、Clean、Trim；**Hardware**：Storage、Graphics、Cooling、Battery；底部 Settings。标准 macOS 侧栏样式，SF Symbols 风格单色图标。
- **Clean 欢迎屏** [已核实-图]：https://cindori.com/_next/image?url=%2Fimages%2Fsensei%2Fclean-large.png&w=1960&q=92
  - 布局与 CleanMyMac **几乎同构**：左中一个大物体（一只写实的、装满文件的金属废纸篓），右侧标题 “Clean” + 一段说明 + 两条带图标要点（Recycle disk space / Clean up your system）+ 一个蓝色 **View Items** 按钮。区别是：纯深灰底、无渐变、按钮是系统蓝矩形。
- **Dashboard** [已核实-图]：https://cindori.com/_next/image?url=%2Fimages%2Fsensei%2Fdashboard-large.png&w=2408&q=90 —— 顶部机型照片 + 规格表，下面是 Battery / SSD / CPU / RAM / GPU 卡片，环形量表 + 细条形图，蓝色为主色。
- **口碑**：Macworld “A slick-looking utility”；官网称“与 macOS 无缝融合”。
- 更多截图：https://cindori.com/sensei

---

## 5. BuhoCleaner（Dr.Buho）——“轻量版 CleanMyMac”

- **导航** [已核实-图]：深海军蓝侧栏，仅 6 项：**Flash Clean / App Uninstall / Large Files / Duplicates / Startup Items / Toolkit**。
- **结果页** [已核实-图]：https://www.drbuho.com/_next/image?url=%2Fimages%2Fbuhocleaner%2Fen%2Fmain%402x.png&w=3840&q=85
  - 纯色中蓝底；标题 “**Found Junk 57.69 GB**”（数字加粗）；下面一列 9 行纯文字分类 + 大小（Xcode Junk、System Cache Files、Unused DMG Files、Purgeable Space…）；一个小的 “View Details”；然后 “**Smart-selected 37.49 GB**” + 一个宽胶囊蓝色 **Remove**。左上 “Start Over”。
  - 要点：把“发现了多少”和“我替你选了多少”分成两个数字，这是很好的信任设计。
- **菜单栏**：RAM/磁盘/CPU 温度/风扇/网速 + 快捷操作。
- **价格**：约 $39.99/年 或 $96.99 终身（Nektony 口径；各站不一致）；免费版可无限扫描 + 清理 3 GB。
- 来源：https://www.drbuho.com/buhocleaner ｜ https://nektony.com/reviews/buhocleaner-vs-maccleaner-pro

---

## 6. CCleaner for Mac（Gen Digital）

- **功能**：清理垃圾、浏览器清理、查找重复、卸载应用、分析照片（模糊/过曝/重复）、启动项。[已核实-文] https://www.ccleaner.com/ccleaner-mac
- **首页** [仅见官方示意图]：https://cdn-production.ccleaner.com/site/nt1hqv4v/mac-new-hero-image.png —— 浅灰蓝底，顶部居中 Logo，2×3 的功能卡片网格，每张卡一个线性图标 + 一个蓝色按钮。真实界面截图 **[未能核实]**。
- **流程**：进入某个工具 → 扫描 → 勾选（Select all / Select none）→ 清理；部分项需先退出相关应用。
- **版本层级**：Free / Professional / Professional Plus（3 台，含 PC 与 Android）。价格约 $39.95/年（各站不一致）。
- **口碑**：“not as flashy as other Mac cleaners”，简单但在 macOS 上显得过时；重复文件要点复选框而不能点文件名；启动项缺少解释。来源：https://www.drbuho.com/review/ccleaner-for-mac-review ｜ https://www.macworld.com/article/352988/cccleaner-review-macos.html

---

## 7. Cleaner One Pro（Trend Micro）

- **功能**：Smart Scan、Junk Files、Big Files、Disk Map、Duplicate Files、Similar Photos、App Manager、Startup Manager、File Shredder、漏洞扫描。标语 “Your Mac — Cleaner, Faster & Safer”。[已核实-文] https://cleanerone.trendmicro.com/cleaner-one-pro-for-mac/
- **界面** [已核实-图，分辨率低]：https://cleanerone.trendmicro.com/images/en-us/clean-junk-on-mac.webp —— **白底**，左侧浅灰窄侧栏（图标 + 小字），内容区左上是大标题 “Junk Files” + 一句话 + 一个蓝色 Scan 按钮；右侧是黄色与薄荷绿的大圆形色块装饰。扁平、明亮、无 3D。
- 官网主视觉是一枚白色 3D 火箭（等距插画风）。
- **价格**：约 $24.99/年起（二手口径）；App Store 版免费 + 内购。
- **口碑**：干净、适合新手、Disk Map 好用；扫描偏浅、有升级提示。来源：https://mackeeper.com/blog/cleaner-one-pro-review/（竞品所写，注意偏向）｜ https://www.cultofmac.com/740768/trend-micro-cleaner-one-pro/

---

## 8. Disk Diag / Disk Doctor

- **Disk Diag**（Rocky Sand Studio，Mac App Store）：一体化磁盘清理 + 重复查找 + 磁盘/内存/CPU 仪表盘 + 菜单栏项；免费清理有额度，之后需购买 “Unlimited Cleaning”。2014 年 Engadget 描述为“单窗口：顶部一个磁盘占用仪表、下方文件类型列表”；v2 已完全重写，**当前界面 [未能核实]**。用户抱怨：无法选择具体文件、无法保留重要缓存。来源：https://apps.apple.com/us/app/disk-diag/id672206759 ｜ https://www.engadget.com/2014-01-10-disk-diag-a-popular-but-odd-mac-utility.html
- **Disk Doctor**（FIPLAB）：**[未能核实]**，本次检索未得到任何可用信息。[背景知识] 它同样是“一个大圆环/仪表 + 一个扫描按钮 + 分类勾选列表”的单屏应用。

---

## 9. AppCleaner / Pearcleaner / OnyX（免费派）

- **AppCleaner**（FreeMacSoft，3.7，免费/捐赠）：整个应用就是一个小窗口——“把应用拖到这里”→ 列出相关文件 → 点删除。极简到没有导航。截图：https://freemacsoft.net/img/appcleaner.png（我未能成功查看）。https://freemacsoft.net/appcleaner/
- **Pearcleaner**（开源，Apache 2.0 + Commons Clause，5.4.3，15.2k stars；README 称 2025 年底起开发**暂停**）：卸载、孤儿文件搜索、Homebrew 管理、开发环境清理、lipo 瘦身、Finder 右键扩展、Sentinel（应用进废纸篓时自动清理）、可自定义主题色。原生 SwiftUI 风格。截图在 README：https://github.com/alienator88/Pearcleaner （界面外观 **[未能核实]**，图片未加载）
- **OnyX**（Titanium Software，免费；5.1.2 对应 macOS 27）：验证系统文件结构、维护脚本、重建数据库与索引、清缓存、隐藏设置。每个 macOS 大版本一个专用版本，官方强调“务必使用正确版本”。界面是传统的工具栏分页 + 大量复选框 **[背景知识]**——它代表“专家工具”的另一端：强大、可信、但毫无情绪设计。https://www.titanium-software.fr/en/onyx.html

---

## 10. Mole（开源 CLI，76k stars）——功能模型参考

来源：https://github.com/tw93/Mole ｜ 宣传图：https://github.com/tw93/Mole/raw/main/docs/img/big-mole.png [已核实-图]

| 命令 | 做什么 |
|---|---|
| `mo` | 交互式菜单 |
| `mo clean` | 缓存、日志、临时文件、开发产物、已卸载应用残留，清空废纸篓 |
| `mo uninstall` | 应用 + LaunchAgents + 偏好 + 残留；默认保留个人数据 |
| `mo optimize` | 有边界的维护：刷新 QuickLook/图标缓存、DNS、数据库优化、磁盘健康 |
| `mo analyze` | 交互式磁盘浏览器，找大文件 |
| `mo status` | 只读实时仪表盘 + 0–100 健康分 |
| `mo purge` | 清理可重建的项目产物（node_modules、target、dist…） |
| `mo installer` | 找 DMG/PKG/ISO 等安装包 |
| `mo slim` | 剥离 Universal 应用里的 Intel 代码 |
| `mo history` | 清理历史日志 |

**安全模型（很值得抄）**：`--dry-run` 预览；白名单；白名单读不到就中止；uninstall/analyze 进废纸篓，clean/purge 永久删除并明确告知；purge 默认不选 7 天内动过的产物、保护 Git 跟踪文件；所有操作写日志；“无法证明安全的路径就跳过”。
**完成文案**：“CLEANUP COMPLETE! Space freed: 85.33GB | Free space now: 172Gi / **That's like ~19 4K movies worth of space!**” —— 把字节换算成人能感知的东西。

---

## 11. 腾讯柠檬清理（Lemon Cleaner）

来源：https://lemon.qq.com/ ｜ https://github.com/Tencent/lemon-cleaner （6.4k stars，GPL v2/v3）

- **首页** [已核实-图]：https://github.com/Tencent/lemon-cleaner/raw/master/Resource/lemon_app.png
  - 白底、左右分栏。**左栏**：一个金黄色渐变的六边形（柠檬切面）Logo 插画，标题 “**畅快清理，清爽一下**”，小字 “欢迎使用 Lemon Cleaner”，一个绿色渐变矩形按钮 “**开始扫描**”。**右栏**：2×4 功能入口（线性图标 + 标题 + 一行说明）：大文件清理、重复文件清理、相似照片清理、应用卸载、隐私清理、开机启动项管理、磁盘空间分析、柠檬精选。
  - 即“左边一键主流程 + 右边工具箱”的经典国内管家布局，但做得很克制。
- **特色**：针对微信、QQ、企业微信、Xcode、Sketch 的**定制清理方案**；“安全空间整理 / 一键搬家”；状态栏小窗（内存、磁盘、CPU 温度、风扇、网速、摄像头/麦克风调用提示）。
- **视觉**：黄 + 绿点缀、大面积留白、等距立方体图形；官网文案 “简约设计，极简操作”。
- **价格**：免费；App Store 版为 Lite（审核限制，无应用卸载等），官网完整版已公证。
- 版本号：官网显示不一致（5.3.0 与 4.8.9 链接并存），**[未能核实]** 最新版本。

---

## 12. Gemini 2（MacPaw，重复文件）

来源：https://macpaw.com/gemini ｜ 截图 [已核实-图]：https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=756,dpr=2/images/products/gemini/duplicates@2x.png

- **结果页**：灰色磨砂窗体；左侧一个**多色圆环**，中心放类别图标（相机）+ “8.96 GB Found in Images”；右侧 “**Scan Completed**”、大数字 “40.73 GB *Automatically selected*”、小表 “What will be removed: Duplicated folders 22.47 GB / Duplicated movies 9.68 GB / Copied photos 4.33 GB”；两个按钮并排：**Review Results**（深色）与 **Smart Cleanup**（亮色、主操作）。
- 这是“**一键 vs 审阅**”二选一的最清晰范例，同时明确说出“将要删除什么”。
- **撤销**：“Gemini moves duplicates to the Trash and lets you bring them back in a click.”
- Red Dot 界面设计奖；自述 “officially the prettiest duplicate finder out there”。$1.95/月起。
- 其余截图：…/gemini/similars@2x.png ｜ …/gemini/trash@2x.png（同一路径前缀）

---

## 13. 空间可视化：GrandPerspective / Space Lens

- **GrandPerspective**（开源 GPL，3.8.1；SourceForge 免费，App Store $2.99）：**矩形树图（treemap）**，“每个文件是一个面积与大小成正比的矩形”；可按名称/扩展名/类型/文件夹/日期上色。信息密度最高、最不“好看”。截图：https://grandperspectiv.sourceforge.net/ScreenShots/3_4-FoldersBujumbura.png https://grandperspectiv.sourceforge.net/
- **Space Lens（CleanMyMac）**：气泡图，信息密度最低、最“好玩”（见 1.4）。
- **DaisyDisk**：旭日图，介于两者之间（见第 3 节）。
- Eclectic Light 认为系统自带的 Documents 浏览器“不如 DaisyDisk 和 GrandPerspective”。

---

## 14. macOS 自带：系统设置 > 通用 > 储存空间

截图 [已核实-图]（macOS Tahoe 26.2）：https://eclecticlight.co/wp-content/uploads/2025/12/storage1a.jpg
来源：https://eclecticlight.co/2025/12/20/explainer-storage-settings/ ｜ https://support.apple.com/en-us/102624 ｜ https://support.apple.com/guide/mac-help/sysp4ee93ca4/mac

三段式，从上到下：
1. **储存条**：一条细长的多色分段条（文稿红、应用橙、开发者黄、信息绿、照片…、系统数据灰），右上 “已用 x / 共 y”，下方一行图例；“All Volumes…” 按钮。
2. **Recommendations（建议）**：三行，每行“图标 + 标题 + 两行解释 + 右侧一个按钮”：Store in iCloud… / Optimise Storage / Empty Trash automatically（30 天）。
3. **分类列表**：Applications、Books、Developer、Documents、iCloud Drive、Mail、Messages、Photos… 每行“图标 + 名称 + 大小 + ⓘ”，点 ⓘ 进入该类的文件表格（可按大小/上次访问排序并删除）。最底部 macOS 与 System Data（**没有 ⓘ**，这是公认的最大短板）。

设计语言：零装饰、零动效、零情绪；**“建议”与“明细”分离**；每条建议只有一个按钮。

## 15. iOS / iPadOS 储存空间建议 [主要来自二手来源，部分 [背景知识]]

- 路径：设置 > 通用 > iPhone 储存空间。顶部同样是多色分段条；其下是**“建议”卡片**（如 Offload Unused Apps、Review Large Attachments、iCloud 照片、自动删除旧对话），每张卡片写明**可节省的空间**并给一个 “Enable / 启用” 按钮；多条时有 “Show All”。再下面是按大小排序的 App 列表，带“上次使用”日期。
- Offload 的关键设计：**删除应用但保留文稿与数据**，图标旁出现小云朵，点一下恢复——“可逆”被做进了机制本身。
- 来源：https://support.apple.com/en-gb/ht201656 ｜ https://www.macrumors.com/how-to/save-storage-space-ios-11/ ｜ https://ios.gadgethacks.com/how-to/free-up-storage-space-iphone/

---

## 16. “高级工具应用”参照系（非清理类）

> 本节主要是 **[背景知识]**，本次检索没有拿到可直接引用的设计拆解文章；链接为官方页面，供自行查看截图。

- **Things 3**（Cultured Code，两届 Apple Design Award）：极大留白、单一强调色（蓝）、自定义但克制的动效（“魔法加号”按钮、列表展开）。https://culturedcode.com/things/
- **Craft**（2021 年 Mac App of the Year）：原生性能 + 柔和阴影卡片 + 细腻的排版层级。https://www.craft.do/
- **Raycast**：首次启动的引导流程（深色、逐步揭示、键盘优先）、一致的 8px 栅格与图标体系。https://www.raycast.com/
- **Bartender / CleanShot X / Klack 等**：一个设置窗口就是全部界面，却做到像系统设置一样规整。https://www.macbartender.com/ ｜ https://cleanshot.com/
- 共同点：**原生控件优先、只有一处“签名式”自定义、动效短且有因果、文案像人说话、从不在界面里叫卖。**
- 有据可查的反向证据：独立清理应用 OptiClear 的作者称，把界面做得“像 Apple 会预装的东西”（标准 SwiftUI + 轻微玻璃、无雷达动画、无红色警告，文案改为中性的 “Ready to clear”）后 App Store 转化率 16%；他认为多数清理软件“像科幻控制台”，是为了制造恐慌。（无对照实验，仅作者自述。）https://www.producthunt.com/p/opticlear-storage-cleaner/how-making-my-mac-app-look-boring-gave-me-a-16-app-store-conversion-rate

---

## 17. 综合：CleanMyMac 级应用到底“高级”在哪里

### 17.1 版式比例（由截图量得，近似值）
- 窗口约 **1.6 : 1**，最小 1200×800（官网要求），大圆角，无标题栏。
- 欢迎屏：侧栏 ≈ 20% 宽；主视觉物体 ≈ 30% 宽、垂直居中略偏上；文字块在右侧 40% 区域，左对齐；主按钮在底边正中，直径 ≈ 窗宽 7–9%。**内容区 60% 以上是空的渐变。**
- 结果屏：侧栏收成 ≈ 6% 的图标条；一句标题 + 5 块磁贴（3+2），磁贴间距 ≈ 磁贴圆角半径；每块磁贴内只有 4 个元素（名称、物体、数字短语、Review）。
- 完成屏：一块面板、一个物体、一个数字、两个按钮。

### 17.2 主视觉处理
- **是物体，不是插画**：有厚度、折射、高光的 3D 渲染物，像一件摆在桌上的产品。
- **一个模块一个物体**，在导航图标 / 欢迎屏 / 结果磁贴 / 完成屏四处复用，形成记忆。
- **允许出血**：物体被磁贴裁切、或压出面板边缘，打破网格才显得“贵”。
- 物体自带语义（刮板擦屏幕 = 清理，举手 = 阻止威胁，闪电 = 性能）。

### 17.3 颜色
- **整窗换色**代替面包屑：用户靠底色就知道自己在哪。
- 深色、低明度、宽幅渐变 + 半透明白色玻璃层；文字永远是白色，三档透明度做层级。
- 主按钮颜色取自当前模块渐变里最亮的一端，所以永远和背景同色系而不是“系统蓝”。
- 红色几乎不用：连“1 threat”都是洋红底白字，不是警报红。

### 17.4 动效与声音
- 有据可查的只有：3D animated interface、视差、悬停效果、环境音（X 时代）、可关闭的 Reduce Motion。
- 可以确定的设计意图：动效用于**“扫描中”和“状态转换”**（侧栏收起、底色过渡、物体入场），而不是装饰静态页面。
- 具体时长、缓动、音效 **[未能核实]**——建议你在真机或 MacPaw 官方视频里看。

### 17.5 文案
- **一句完整的人话当标题**：“Your tasks are ready to run. Look what we found:”、“There are 5 GB of junk files on your Mac.”、“You have 12,711 files to sort through. Use quick recommendations or review them by hand.”
- **数字 + 名词 + 动词短语**：“8,2 GB of junk / to clean”、“1 threat / to remove”、“2 tasks / to run”。
- **无事可做也说人话**：“No vital updates”。
- 动词只有三个：**Scan → Review → Run（Clean / Remove）**，完成后 **Done**。
- 完成语克制：“Cleanup complete!” + 一个数字 + “View Log”。
- 署名传递信任：“by MacPaw”、“Protection by Moonlock”。

### 17.6 Mac 清理软件的共同心智模型
1. **一个“全家桶入口”**（Smart Care / Find & Fix / Smart Scan / Flash Clean / 开始扫描）+ **若干专项工具**（垃圾、大文件、重复、卸载、启动项、空间可视化）。
2. **三拍子流程**：扫描 → 摘要（可一键执行，也可审阅）→ 完成（一个数字）。
3. **两层信息**：第一层是摘要与情绪，第二层是可勾选的明细列表 + 每类的白话解释。
4. **“发现了多少”≠“替你选了多少”**（BuhoCleaner 的 Found / Smart-selected，Gemini 的 Automatically selected）。
5. **安全承诺**是品类标配：默认不动用户文件、忽略列表、进废纸篓可恢复、系统文件保护、日志。
6. **菜单栏常驻小组件**：健康状态 + 磁盘/内存/CPU/网络磁贴 + “今日建议”一条。
7. **空间可视化**是高级用户的入口（旭日图 / 气泡 / 树图）。
8. 系统自带方案的模型是“**容量条 + 建议 + 分类明细**”，第三方是在这之上加情绪与自动化。

### 17.7 反模式（都有来源支撑）
- 常驻的升级按钮、聊天面板、扫描中途弹窗（MacKeeper）。
- 结果页最大的按钮是“激活并修复”而不是“查看”。
- 划线价、退出挽留折扣、续费价藏在 tooltip。
- 雷达式扫描动画 + 大红警告 + 夸大“问题数”（OptiClear 作者的批评；MacKeeper 的历史名声）。
- 动效与色彩过量且不可关（TidBITS 读者对 CleanMyMac 的抱怨；后来加了 Reduce Motion）。
- 删除不可选、不可排除（Disk Diag 用户差评；CleanMyMac 被指删掉需要的语言文件）。
- 首屏堆满仪表盘数字却没有一个明确的下一步（Sensei Dashboard 适合监控，不适合作为清理入口）。
- 直接把 Windows 版界面搬到 Mac（CCleaner 被评“dated”）。
- 名不副实（Disk Diag 并不做磁盘诊断）。

---

## 18. 对一款“同样高级”的 Windows 清理应用的 10 条具体启示

1. **首屏只留一件事**。一个主视觉物体 + 一句话 + 一个按钮；磁盘占用、历史记录、设置全部移出首屏。目标：除导航外可点击元素 ≤ 2 个，内容区留白 ≥ 60%。
2. **做一个“物体”，而不是图标或插画**。为每个模块设计一件有厚度和材质的 3D 物件（可用预渲染序列帧或 Lottie/Rive，不必实时 3D），并在导航、欢迎屏、结果磁贴、完成屏四处复用；允许它出血、被裁切。
3. **用整窗底色做导航**。每个模块一套宽幅深色渐变，切换模块时底色过渡（300–500ms）。在 Windows 上可叠加 Mica/Acrylic，但**渐变要自己画**，不要只依赖系统材质，否则会和所有 WinUI 应用长得一样。
4. **结果页用磁贴，不用表格**。每块磁贴严格四要素：模块名（可勾选）、物体、“数字 + 名词 / 动词短语”、Review。把文件明细放到第二层，并让第二层回到朴素的原生列表风格，形成“情绪层 / 工作层”的对比。
5. **区分“发现”与“已为你选择”**，并提供 **Review 与 Run 并列**的二选一（参考 Gemini 2、BuhoCleaner）。默认选择必须保守，且每个分类配一段白话解释“这是什么、为什么可以删”。
6. **把安全做进机制并说出来**：默认进回收站 / 可恢复期；忽略列表；dry-run 预览；操作日志（完成页放 “查看日志”）；最近 N 天修改的项目默认不选（学 Mole）。Windows 用户对“清理软件 = 流氓软件”的戒心比 Mac 用户更重，这一条比视觉更重要。
7. **文案用完整句子和三个动词**：扫描 → 查看 → 清理，完成即 “完成”。标题写成一句话（“你的电脑上有 5 GB 可以清理的文件”），无事可做时也说人话（“没有需要处理的更新”）。完成页只放一个数字，可附一个可感知换算（“约等于 19 部 4K 电影”）。
8. **红色禁用，警报禁用**。不显示“发现 1,243 个问题”，不做雷达扫描，不在扫描过程中弹任何升级或推荐。付费点只出现在用户主动触达付费功能的那一刻，且界面里不放常驻升级按钮、不放聊天面板、不做划线价。
9. **动效只服务于状态转换，并且可关闭**：扫描中（物体循环动画 + 当前扫描项的一行小字）、侧栏收起、磁贴依次入场、完成时物体的一次性“收尾”动作。必须尊重系统的“动画效果”开关，并提供应用内 Reduce Motion。声音若做，只做完成时的一声且默认可关。
10. **给克制派留一条路**：提供一个系统设置式的“储存空间”视图（容量分段条 + 建议卡片各带一个按钮 + 分类明细）和一个旭日图/树图的空间分析器。这既满足高级用户，也是对客户“Apple-like”要求最直接的回应——Apple 自己的做法其实是零装饰的；CleanMyMac 的华丽与系统设置的朴素，共同点是**每屏只有一个决定要做**。

附加建议：先定“签名元素”只有一个（建议就是底部正中的圆形主按钮 + 模块物体），其余全部用 Windows 11 原生控件与排版（Segoe UI Variable、4/8px 栅格、标准圆角）。高级感来自“一处大胆 + 处处规矩”，而不是处处自定义。

---

## 19. 截图 / 可视资料索引

**CleanMyMac**
- Smart Care 欢迎屏：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/810a3ee0-df6f-4b3b-9af6-20ddbdd02896.webp
- Smart Care 结果磁贴：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/7c6d9bf8-a545-4353-8d34-61b8070af7f9.webp
- 待执行任务：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/aef144b0-d44b-4637-9df8-98ee3c734b99.webp（未查看）
- Review 明细（Cleanup Manager）：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/f296b094-6321-4b20-b995-a16b07b456ae.webp
- 被跳过模块的结果：https://cms-assets-proxy.macpaw.com/cdn-cgi/image/format=auto,quality=90/37e1ef6a-53ae-41bc-9cf3-e02dd1a2b5c5.webp（未查看）
- 完成页（Cleanup complete!）：https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=640,dpr=2/images/content/image_1779975289.png
- Protection 结果页：https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=640,dpr=2/images/content/image_1779977559.png
- Cloud Cleanup 欢迎屏：https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=640,dpr=2/images/content/image_1779980006.png
- Cleanup 结果页（绿色）：https://9to5mac.com/wp-content/uploads/sites/6/2024/10/Screenshot-2024-10-16-at-9.28.57%E2%80%AFAM.png?w=1024
- Assistant：https://9to5mac.com/wp-content/uploads/sites/6/2024/10/Screenshot-2024-10-16-at-9.12.07%E2%80%AFAM.png?w=1024
- 新旧对比：https://9to5mac.com/wp-content/uploads/sites/6/2024/10/Screenshot-2024-10-16-at-7.59.12%E2%80%AFAM.png（未查看）
- 菜单栏应用：https://cdn.macstories.net/cleanshot-2024-10-16-at-11-55-43-2x-1729094287726.png
- My Clutter 结果页：https://cdn.macstories.net/cleanshot-2024-10-16-at-11-32-32-2x-1729093829858.png
- Space Lens：https://b2c-contenthub.com/wp-content/uploads/2025/10/Space-Lens.jpg
- Cloud Cleanup（Macworld）：https://b2c-contenthub.com/wp-content/uploads/2025/10/Cloud-CleanUp.jpg（未查看）
- 官方概览视频封面：https://cdn3.macpaw.com/images/products/cleanmymac-5/overview/video-poster/en-cleanmymac5-overview.jpg
- 更多页面：https://macpaw.com/cleanmymac ｜ https://macpaw.com/support/cleanmymac/knowledgebase/smart-care

**其他**
- DaisyDisk：https://daisydiskapp.com/img/home/intro-ss1.png ｜ https://daisydiskapp.com/img/home/intro-ss2.png ｜ https://daisydiskapp.com/img/home/intro-ss3.png ｜ https://daisydiskapp.com/img/guide/4/en/dd_overview.png
- Sensei：https://cindori.com/_next/image?url=%2Fimages%2Fsensei%2Fclean-large.png&w=1960&q=92 ｜ https://cindori.com/_next/image?url=%2Fimages%2Fsensei%2Fdashboard-large.png&w=2408&q=90 ｜ https://cindori.com/_next/image?url=%2Fimages%2Fsensei%2Fscan-results-large.png&w=980&q=95（未查看）｜ https://cindori.com/_next/image?url=%2Fimages%2Fsensei%2Funinstaller-large.png&w=1960&q=90（未查看）
- BuhoCleaner：https://www.drbuho.com/_next/image?url=%2Fimages%2Fbuhocleaner%2Fen%2Fmain%402x.png&w=3840&q=85
- Gemini 2：https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=756,dpr=2/images/products/gemini/duplicates@2x.png ｜ https://cdn3.macpaw.com/cdn-cgi/image/format=auto,quality=60,width=1321,dpr=2/images/products/gemini/similars@2x.png（未查看）
- 柠檬清理：https://github.com/Tencent/lemon-cleaner/raw/master/Resource/lemon_app.png ｜ https://lemon.qq.com/
- Cleaner One Pro：https://cleanerone.trendmicro.com/images/en-us/clean-junk-on-mac.webp ｜ https://cleanerone.trendmicro.com/cleaner-one-pro-for-mac/
- CCleaner for Mac（示意图）：https://cdn-production.ccleaner.com/site/nt1hqv4v/mac-new-hero-image.png
- MacKeeper：https://mackeeper.com/ （应用内截图未取得直链）
- Mole：https://github.com/tw93/Mole/raw/main/docs/img/big-mole.png
- Pearcleaner：https://github.com/alienator88/Pearcleaner
- GrandPerspective：https://grandperspectiv.sourceforge.net/ScreenShots/3_4-FoldersBujumbura.png
- macOS 储存空间：https://eclecticlight.co/wp-content/uploads/2025/12/storage1a.jpg ｜ https://eclecticlight.co/wp-content/uploads/2025/12/storage2.jpg（未查看）
- AppCleaner：https://freemacsoft.net/img/appcleaner.png（未查看）

---

## 20. 未能核实清单（请勿当作事实引用）

- CleanMyMac 扫描过程中的动画形态、时长、音效；是否有完整浅色主题；清理后是否可撤销；Performance / Applications 模块的整窗底色。
- iF Design 条目原文（403）；MacPaw 关于“情绪旅程研究”的原始表述（仅见检索摘要）。
- MacKeeper 应用内的实际配色与动效（只读到文字评测）。
- CCleaner for Mac 的真实界面（只看到官网线框示意图）。
- Disk Diag 当前版本界面；Disk Doctor 的任何信息。
- Pearcleaner、AppCleaner、OnyX、GrandPerspective 的界面外观（未成功查看图片；文中描述部分为背景知识）。
- DaisyDisk 删除倒计时细节（背景知识）。
- iOS 储存建议的现行确切措辞（来源较旧）。
- 第 16 节关于 Things / Craft / Raycast / Bartender 的设计特征（背景知识）。
- 各家价格在不同来源间不一致，且正值黑五促销，均应以官网结算页为准。
- 若干厂商页面提到 “macOS Golden Gate 27”，我未另行核对该系统版本信息。
