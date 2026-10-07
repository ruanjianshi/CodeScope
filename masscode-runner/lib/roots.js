'use strict';

/* ── 词根词缀库（纯逻辑 ✓，双栖 ✓）────────────────────────────────────────
   ★ 用户原话：「帮我新增词根词缀，方便我查询和记忆相关，大致做成思维导图的样式，
     参考现有的阅读模块的我的英语里面的词根词缀设计，进行合理化设计，
     强化可视化和巧记，图形化等等」✓。

   ★ 为什么要**内置一份**词库 ✗：查词根这件事**不该每次都问 AI** ✓ ——
     ① 慢（要等好几秒 ✓）② 要联网 ✓ ③ 要花 token ✓ ④ **会编** ✗✗
        （模型给的「词源」看着很确定 ✓，但错了用户根本查不出来 ✗ ——
         和「音标背错」是同一类事故 ✓）。
     → 高频词根**离线内置** ✓（这份表是**人工核对过**的 ✓）；
       库里没有的才走 AI ✓，而且**明确标出来**「这是 AI 补的，没核对过」✗。

   ⚠️ 本模块**不能**有任何顶层副作用 ✗、**不能** require 别的东西 ✗
      （它在浏览器里是被 `<script type="module">` 直接加载的 ✓）。
   ⚠️ 双栖导出见文件末尾 ✓（`lib/en-text.js` / `lib/srs.js` 同一个套路 ✓）。 */

/* ── 数据格式 ✓ ────────────────────────────────────────────────────────────
   每条：`[形, 含义, 例词, 巧记, 词源]`
   · **形**用 `|` 分隔变体 ✓，**第一个是规范形** ✓（`'spect|spec|spic'` ✓）——
     查 `spec` 也能查到 `spect` 这一条 ✓。
   · **例词**写成 `inspect 检查 · respect 尊重` ✓（`词 中文` ✓，`·` 分隔 ✓）——
     展示时拆成「词 + 释义」两栏 ✓，比一整串英文好读得多 ✓。
   · **巧记**要**具体**✗ —— 「用词根记」这种废话没用 ✓，
     要么给词源故事 ✓，要么给可操作的联想 ✓。 */
const PRE_RAW = [
  ['a', '不；在…上；加强', 'atypical 非典型的 · asleep 睡着的 · arise 出现', '两种来源：希腊 a-（不）和古英语 on（在…上）—— 看到 a- 先猜「不」或「在」', '希腊 a-（not）/ 古英语 on（on）'],
  ['ab|abs', '离开', 'absent 缺席的 · abstract 抽象的 · abduct 诱拐', 'ab = away ——「把人带走」就是诱拐', '拉丁 ab（away from）'],
  ['ad|ac|af|ag|al|ap|ar|as|at', '朝向；加强', 'adapt 适应 · accept 接受 · affirm 断言', 'ad = to —— 后面那个字母被同化成了 ac/af/ag…，其实都是 ad', '拉丁 ad（to, toward）'],
  ['ante', '前', 'antecedent 先行的 · anteroom 前厅', 'ante = before，和 anti（反对）只差一个字母，别混', '拉丁 ante（before）'],
  ['anti', '反对', 'antiwar 反战的 · antibiotic 抗生素', 'anti = against —— 抗生素就是「反生命（细菌）」的药', '希腊 anti（against）'],
  ['auto', '自己', 'automatic 自动的 · autobiography 自传', 'auto = self —— 自己给自己写传记 = 自传', '希腊 autos（self）'],
  ['be', '使；加强', 'belittle 贬低 · beloved 心爱的', 'be- 加在动词前多半是「使…」', '古英语 be-'],
  ['bi|bin', '二', 'bicycle 自行车 · bilingual 双语的', 'bi = two —— 两个轮子 = 自行车', '拉丁 bi（two）'],
  ['circum', '环绕', 'circumstance 环境 · circumvent 绕过', 'circum = around —— 绕着走 = 绕过', '拉丁 circum（around）'],
  ['co|com|con|col|cor', '共同；加强', 'cooperate 合作 · connect 连接 · collect 收集', 'co = together —— 后面的字母被同化成 com/col/cor，都是 co', '拉丁 co（together）'],
  ['contra|counter', '反对', 'contradict 反驳 · counterattack 反击', 'contra = against —— 说反话 = 反驳', '拉丁 contra（against）'],
  ['de', '向下；去除；加强', 'descend 下降 · deforest 砍伐森林', 'de = down / away ——「往下」和「去掉」是一体的', '拉丁 de（down, away）'],
  ['di|dis|dif', '分开；不', 'divide 分开 · disagree 不同意 · differ 不同', 'dis = apart —— 分开就变成了「不」', '拉丁 dis（apart）'],
  ['dia', '穿过；之间', 'diameter 直径 · dialogue 对话', 'dia = through —— 穿过圆心量到底 = 直径', '希腊 dia（through）'],
  ['dys', '坏的；困难的', 'dysfunction 功能障碍 · dyslexia 阅读障碍', 'dys = bad —— 和 eu（好）正好相反', '希腊 dys（bad）'],
  ['e|ex|ec|ef', '出；前任', 'exit 出口 · export 出口 · exclude 排除', 'ex = out —— 出口就是「走出去的地方」', '拉丁 ex（out）'],
  ['en|em', '使…；进入', 'enable 使能够 · enrich 丰富 · embrace 拥抱', 'en- 加在形容词前 = 使…（enable 使能够）', '拉丁 in（in）→ 法语 en-'],
  ['epi', '在…上；旁', 'epidemic 流行病 · epilogue 尾声', 'epi = upon —— 尾声就是「写在正文之上」的那段', '希腊 epi（upon）'],
  ['eu', '好', 'euphemism 委婉语 · euphoria 欣快', 'eu = good —— 说好话 = 委婉语', '希腊 eu（good）'],
  ['extra', '超出', 'extraordinary 非凡的 · extract 提取', 'extra = outside —— 超出常规 = 非凡', '拉丁 extra（outside）'],
  ['fore', '前；预先', 'forecast 预报 · forehead 前额', 'fore = before —— 额头就是头的前面', '古英语 fore（before）'],
  ['hetero', '不同', 'heterogeneous 异质的', 'hetero = other —— 和 homo（相同）成对记', '希腊 heteros（other）'],
  ['homo', '相同', 'homogeneous 同质的', 'homo = same —— 同质的就是「一个样」', '希腊 homos（same）'],
  ['hyper', '过度；超', 'hyperactive 极度活跃的 · hypertension 高血压', 'hyper = over —— 血压过度 = 高血压', '希腊 hyper（over）'],
  ['hypo', '下；次；假', 'hypothesis 假设 · hypocrisy 伪善', 'hypo = under —— 放在下面当垫底 = 假设', '希腊 hypo（under）'],
  ['il|im|in|ir', '不；向内', 'illegal 非法的 · impossible 不可能的 · import 进口', 'in- 有两种意思：in（向内）和 not（不）—— 看后面的词性猜', '拉丁 in（in / not）'],
  ['inter', '之间；相互', 'international 国际的 · interrupt 打断', 'inter = between —— 国与国之间 = 国际', '拉丁 inter（between）'],
  ['intra|intro', '内部', 'intranet 内网 · introduce 引入', 'intra = within（内部），inter = between（之间），差一个字母', '拉丁 intra（within）'],
  ['macro', '大', 'macroeconomics 宏观经济学', 'macro = large —— 和 micro（小）成对', '希腊 makros（large）'],
  ['micro', '小', 'microscope 显微镜 · microwave 微波', 'micro = small —— 看小东西的镜子 = 显微镜', '希腊 mikros（small）'],
  ['mid', '中间', 'midnight 午夜 · midway 中途', 'mid = middle —— 简单直白', '古英语 mid'],
  ['mis', '错误；坏', 'mistake 错误 · misunderstand 误解', 'mis = wrong —— 拿错了 = 错误', '古英语 mis-'],
  ['mono', '单一', 'monopoly 垄断 · monotonous 单调的', 'mono = one —— 一家独卖 = 垄断', '希腊 monos（one）'],
  ['multi', '多', 'multimedia 多媒体 · multiply 乘', 'multi = many —— 多种媒体 = 多媒体', '拉丁 multus（many）'],
  ['neo', '新', 'neolithic 新石器的', 'neo = new —— 和 nov（新）同源', '希腊 neos（new）'],
  ['non', '非；不', 'nonsense 胡说 · nonprofit 非营利的', 'non = not —— 直接否定，最省事的那个', '拉丁 non（not）'],
  ['ob|oc|of|op', '反对；朝向；加强', 'object 反对 · occupy 占据', 'ob = against —— 把东西扔到对面去 = 反对', '拉丁 ob（against, toward）'],
  ['out', '超过；向外', 'outperform 胜过 · outdoor 户外的', 'out = beyond —— 做得比对手更 out = 胜过', '古英语 ut'],
  ['over', '过度；在上', 'overwork 过劳 · overlook 俯视', 'over 既是「在上面」也是「过头了」', '古英语 ofer'],
  ['pan', '全；泛', 'pandemic 大流行 · panorama 全景', 'pan = all —— 所有人都得的病 = 大流行', '希腊 pan（all）'],
  ['para', '旁边；辅助', 'parallel 平行的 · paraphrase 释义', 'para = beside —— 并排走 = 平行', '希腊 para（beside）'],
  ['per', '贯穿；完全', 'perfect 完美的 · permanent 永久的', 'per = through —— 从头做到尾 = 完美', '拉丁 per（through）'],
  ['peri', '周围', 'perimeter 周长 · periscope 潜望镜', 'peri = around —— 绕着量一圈 = 周长', '希腊 peri（around）'],
  ['poly', '多', 'polygon 多边形 · polyglot 通晓多语的', 'poly = many —— 和 multi 同义，poly 多来自希腊', '希腊 polys（many）'],
  ['post', '后', 'postpone 推迟 · postwar 战后的', 'post = after —— 和 pre（前）成对', '拉丁 post（after）'],
  ['pre', '前；预先', 'predict 预测 · prepare 准备', 'pre = before —— 提前说 = 预测', '拉丁 prae（before）'],
  ['pro', '向前；支持', 'progress 进步 · promote 促进', 'pro = forward —— 往前走 = 进步', '拉丁 pro（forward）'],
  ['re', '再；回；向后', 'return 返回 · review 复习', 're = back / again —— 往回做一遍 = 复习', '拉丁 re（back, again）'],
  ['retro', '向后', 'retrospect 回顾 · retroactive 追溯的', 'retro = backward —— 往回看 = 回顾', '拉丁 retro（backward）'],
  ['se', '分开', 'separate 分开 · select 挑选', 'se = apart —— 挑出来就是「分」出来', '拉丁 se（apart）'],
  ['semi', '半', 'semicircle 半圆 · semiconductor 半导体', 'semi = half —— 半个圆 = 半圆', '拉丁 semi（half）'],
  ['sub|suc|suf|sug|sup|sus', '下；次；副', 'submarine 潜艇 · support 支持', 'sub = under —— 在水下面走的船 = 潜艇', '拉丁 sub（under）'],
  ['super|sur', '超过；在上面', 'supervise 监督 · surface 表面', 'super = above —— 在上面看 = 监督', '拉丁 super（above）'],
  ['syn|sym|syl|sys', '共同；一起', 'synonym 同义词 · sympathy 同情', 'syn = together —— 名字放一起 = 同义词', '希腊 syn（together）'],
  ['tele', '远', 'telephone 电话 · telescope 望远镜', 'tele = far —— 远处传声 = 电话', '希腊 tele（far）'],
  ['trans', '穿过；转变', 'transport 运输 · transform 转变', 'trans = across —— 跨过去运 = 运输', '拉丁 trans（across）'],
  ['tri', '三', 'triangle 三角形 · tricycle 三轮车', 'tri = three —— 三个轮子 = 三轮车', '希腊 treis / 拉丁 tres（three）'],
  ['ultra', '极端；超', 'ultrasonic 超声的', 'ultra = beyond —— 超出人耳范围 = 超声', '拉丁 ultra（beyond）'],
  ['un', '不；相反；打开', 'unhappy 不快乐的 · undo 撤销', 'un- 加形容词 = 不；加动词 = 反过来做（undo 撤销）', '古英语 un-'],
  ['under', '下；不足', 'underground 地下的 · underestimate 低估', 'under 既指位置也指「不够」', '古英语 under'],
  ['uni', '单一', 'uniform 制服 · unique 独特的', 'uni = one —— 一个样式 = 制服', '拉丁 unus（one）'],
  ['vice', '副的', 'vice-president 副总统', 'vice = 代替 —— 副职就是「替正职办事的人」', '拉丁 vice（in place of）'],
];

const SUF_RAW = [
  ['able|ible', '能…的；可…的', 'comfortable 舒适的 · visible 可见的', '-able 加动词 = 「能被…的」：read → readable', '拉丁 -abilis'],
  ['acy|cy', '状态；性质', 'accuracy 准确性 · privacy 隐私', '形容词加 -cy 变名词：accurate → accuracy', '拉丁 -cia'],
  ['age', '行为；状态；集合', 'marriage 婚姻 · storage 存储', '动词加 -age = 这件事本身：marry → marriage', '法语 -age'],
  ['al', '…的；行为', 'natural 自然的 · arrival 到达', '-al 既是形容词后缀也是名词后缀，看词性', '拉丁 -alis'],
  ['ance|ence', '状态；性质', 'importance 重要性 · difference 差别', '动词加 -ance/-ence = 抽象名词：differ → difference', '拉丁 -antia'],
  ['ant|ent', '人；…的', 'assistant 助手 · different 不同的', '同后缀兼两用：assist → assistant（人）；differ → different（的）', '拉丁 -ans'],
  ['ary', '…的；场所；人', 'military 军事的 · library 图书馆', '放东西的地方 = -ary：libr → library', '拉丁 -arius'],
  ['ate', '使…；…的', 'activate 激活 · accurate 准确的', '名词/形容词加 -ate 变动词：active → activate', '拉丁 -atus'],
  ['dom', '领域；状态', 'freedom 自由 · kingdom 王国', '-dom 造抽象名词：free → freedom', '古英语 -dom'],
  ['ee', '受动者（被动）', 'employee 雇员 · trainee 受训者', '⚠️ -er 是**做**的人（employer 雇主），-ee 是**被做**的人（employee 雇员）—— 这两个最容易搞反', '法语 -é'],
  ['en', '使…；由…制成', 'strengthen 加强 · wooden 木制的', '形容词加 -en 变动词：strength → strengthen', '古英语 -nian'],
  ['er|or|ar', '人；物；工具', 'teacher 老师 · actor 演员', '-er 最通用，-or 多接拉丁词根（act → actor）', '拉丁 -or / 古英语 -ere'],
  ['ery', '行为；场所；集合', 'bravery 勇敢 · bakery 面包店', '做这事的地方 = -ery：bake → bakery', '法语 -erie'],
  ['ful', '充满…的', 'useful 有用的 · beautiful 美丽的', '名词加 -ful = 满的：use → useful', '古英语 -ful'],
  ['fy|ify', '使…', 'simplify 简化 · classify 分类', '形容词加 -ify 变动词：simple → simplify', '拉丁 -ificare'],
  ['hood', '身份；状态；时期', 'childhood 童年 · neighborhood 邻里', '名词加 -hood = 那个阶段：child → childhood', '古英语 -had'],
  ['ic|ical', '…的；…学的', 'historic 历史的 · logical 逻辑的', '-ic 和 -ical 常成对：historic（有历史意义的）/ historical（历史学的）', '希腊 -ikos'],
  ['ing', '动作；…的', 'running 跑步 · interesting 有趣的', '动名词和现在分词是同一个形式，看它在句子里干什么', '古英语 -ende'],
  ['ion|tion|sion|ation', '行为；结果', 'action 行动 · decision 决定', '动词加 -ion = 这件事：act → action', '拉丁 -io'],
  ['ise|ize', '使…化', 'realize 实现 · modernize 现代化', '名词/形容词加 -ize = 使成为：modern → modernize', '希腊 -izein'],
  ['ish', '略…的；…人；…的', 'childish 幼稚的 · British 英国的', '-ish 表「有点像」：child → childish（像小孩一样）', '古英语 -isc'],
  ['ism', '主义；学说；特征', 'socialism 社会主义', '-ism 是「一套主张」：social → socialism', '希腊 -ismos'],
  ['ist', '人（从事/主张）', 'artist 艺术家 · scientist 科学家', '-ist 是「干这行的人」：art → artist', '希腊 -istes'],
  ['ity|ty', '性质；状态', 'ability 能力 · safety 安全', '形容词加 -ity = 抽象名词：able → ability', '拉丁 -itas'],
  ['ive', '…的；有…性质的', 'active 活跃的 · creative 有创造力的', '-ive 常和 -ion 成对：act → action / active', '拉丁 -ivus'],
  ['less', '无…的', 'hopeless 无望的 · careless 粗心的', '⚠️ 和 -ful 正好相反：useful 有用的 / useless 没用的', '古英语 -leas'],
  ['ly', '…地；…的', 'quickly 快速地 · friendly 友好的', '加形容词 = 副词（quick → quickly）；加名词 = 形容词（friend → friendly）', '古英语 -lice'],
  ['ment', '行为；结果；工具', 'movement 运动 · development 发展', '动词加 -ment = 这件事/这个东西：move → movement', '拉丁 -mentum'],
  ['ness', '性质；状态', 'kindness 善良 · darkness 黑暗', '形容词加 -ness = 抽象名词，最好用的一个后缀', '古英语 -nes'],
  ['ous|ious', '多…的；有…性质的', 'famous 著名的 · curious 好奇的', '名词加 -ous = 充满：fame → famous', '拉丁 -osus'],
  ['ship', '身份；关系；技能', 'friendship 友谊 · leadership 领导', '-ship 表「关系」：friend → friendship', '古英语 -scipe'],
  ['ward', '朝…方向', 'forward 向前 · backward 向后', '-ward 是方向：back → backward', '古英语 -weard'],
  ['y', '…的；名词', 'rainy 多雨的 · difficulty 困难', '名词加 -y = 多的：rain → rainy', '古英语 -ig'],
];

const ROOT_RAW = [
  ['act|ag', '做；驱动', 'act 行动 · agent 代理人 · agenda 议程', 'ag = 做 —— 替你做事的 = 代理人；要做的事 = 议程', '拉丁 agere（to do, drive）'],
  ['alter', '其他；改变', 'alternative 替代的 · alter 改变', 'alter = other —— 换成另一个 = 改变', '拉丁 alter（other）'],
  ['am|amor', '爱', 'amateur 业余爱好者 · amiable 和蔼的', 'am = love —— 因为爱才去做 = 业余爱好', '拉丁 amare（to love）'],
  ['anim', '生命；精神', 'animal 动物 · animate 使有生气', 'anim = life —— 有生命的东西 = 动物', '拉丁 anima（breath, soul）'],
  ['ann|enn', '年', 'annual 年度的 · anniversary 周年', 'ann = year —— 一年一次 = 年度', '拉丁 annus（year）'],
  ['aqua', '水', 'aquarium 水族馆', 'aqua = water —— 装水的池子 = 水族馆', '拉丁 aqua（water）'],
  ['arch', '统治；首要', 'monarch 君主 · architect 建筑师', 'arch = chief —— 一个人管所有人 = 君主', '希腊 archein（to rule）'],
  ['aud|audit', '听', 'audience 听众 · audio 音频', 'aud = hear —— 听的人 = 听众', '拉丁 audire（to hear）'],
  ['bio', '生命', 'biology 生物学 · biography 传记', 'bio = life —— 写一个人的一生 = 传记', '希腊 bios（life）'],
  ['brev', '短', 'brevity 简短 · abbreviate 缩写', 'brev = short —— 缩到最短 = 缩写', '拉丁 brevis（short）'],
  ['cad|cas|cid', '落下；降临', 'accident 事故 · cascade 小瀑布', 'cad = fall —— 落到头上的事 = 事故', '拉丁 cadere（to fall）'],
  ['cap|capt|cept|cip', '拿；抓；容纳', 'capture 捕获 · accept 接受', 'cap = take —— 伸手接住 = 接受', '拉丁 capere（to take）'],
  ['card|cord|cour', '心', 'cardiac 心脏的 · courage 勇气', 'cord = heart —— 心够硬才敢上 = 勇气', '拉丁 cor（heart）'],
  ['ced|ceed|cess', '走；让', 'proceed 进行 · access 进入', 'cess = go —— 走进 = 进入', '拉丁 cedere（to go, yield）'],
  ['centr', '中心', 'central 中心的 · concentrate 集中', 'centr = center —— 都往中间聚 = 集中', '希腊 kentron（center）'],
  ['cern|cret|crim', '分开；判断；辨别', 'concern 关心 · secret 秘密', 'cret = separate —— 分出来藏起来 = 秘密', '拉丁 cernere（to sift）'],
  ['chron', '时间', 'chronic 慢性的 · synchronize 同步', 'chron = time —— 时间对上了 = 同步', '希腊 chronos（time）'],
  ['cid|cis', '切；杀', 'decide 决定 · precise 精确的', 'cid = cut —— 一刀切下去 = 决定（把别的可能切掉）', '拉丁 caedere（to cut）'],
  ['claim|clam', '喊；叫', 'exclaim 呼喊 · proclaim 宣告', 'claim = cry —— 喊出来 = 呼喊', '拉丁 clamare（to cry）'],
  ['clar', '清楚；明亮', 'clarify 澄清 · declare 宣布', 'clar = clear —— 说清楚 = 澄清', '拉丁 clarus（clear）'],
  ['clud|clus', '关闭', 'include 包括 · exclude 排除', 'clud = close —— 关在里面 = 包括', '拉丁 claudere（to close）'],
  ['cogn|gnos', '知道；认识', 'recognize 认出 · diagnose 诊断', 'cogn = know —— 再认一次 = 认出', '拉丁 cognoscere（to know）'],
  ['corp', '身体', 'corporation 公司 · corpse 尸体', 'corp = body —— 一群人凑成一个「身体」= 公司', '拉丁 corpus（body）'],
  ['cosm', '宇宙；秩序', 'cosmic 宇宙的', 'cosm = universe —— 宇宙的秩序', '希腊 kosmos（order, universe）'],
  ['crat|cracy', '统治；权力', 'democracy 民主 · democrat 民主人士', 'cracy = rule —— 人民来管 = 民主', '希腊 kratos（power）'],
  ['cred', '相信', 'credit 信用 · incredible 难以置信的', 'cred = believe —— 值得信 = 信用', '拉丁 credere（to believe）'],
  ['cresc|creas|cret', '增长', 'increase 增加 · crescent 新月', 'cresc = grow —— 一天天长起来 = 新月', '拉丁 crescere（to grow）'],
  ['cur|curs|cour', '跑；流动', 'current 水流 · excursion 远足', 'curs = run —— 跑出去 = 远足', '拉丁 currere（to run）'],
  ['cur|curat', '关心；注意', 'cure 治愈 · accurate 准确的', 'cur = care —— 用心做 = 准确', '拉丁 cura（care）'],
  ['dem', '人民', 'democracy 民主 · epidemic 流行病', 'dem = people —— 在人民中间传 = 流行病', '希腊 demos（people）'],
  ['dent', '牙', 'dentist 牙医', 'dent = tooth —— 管牙的医生 = 牙医', '拉丁 dens（tooth）'],
  ['derm', '皮肤', 'dermatology 皮肤科', 'derm = skin —— 研究皮肤的学科', '希腊 derma（skin）'],
  ['dic|dict', '说；断言', 'predict 预测 · dictionary 词典', 'dict = say —— 提前说 = 预测', '拉丁 dicere（to say）'],
  ['doc|doct', '教；示', 'doctor 医生 · document 文件', 'doct = teach —— 有学问的人 = 博士/医生', '拉丁 docere（to teach）'],
  ['domin', '主人；支配', 'dominate 支配 · dominant 主导的', 'domin = master —— 说了算 = 支配', '拉丁 dominus（master）'],
  ['don|dat|dot', '给', 'donate 捐赠 · data 数据', 'dat = give —— 给出来的东西 = 数据', '拉丁 dare（to give）'],
  ['duc|duct', '引导', 'introduce 介绍 · conduct 引导', 'duct = lead —— 领着进去 = 介绍', '拉丁 ducere（to lead）'],
  ['dur', '持久；硬', 'durable 耐用的 · endure 忍受', 'dur = hard/last —— 撑得住 = 耐用', '拉丁 durare（to last）'],
  ['equ', '相等；平', 'equal 相等的 · equator 赤道', 'equ = equal —— 把地球平分成两半 = 赤道', '拉丁 aequus（equal）'],
  ['err', '走错；犯错', 'error 错误 · erratic 反复无常的', 'err = wander —— 走偏了 = 错误', '拉丁 errare（to wander）'],
  ['fac|fact|fect|fic', '做；制造', 'factory 工厂 · perfect 完美的', 'fact = make —— 做到头了 = 完美', '拉丁 facere（to make）'],
  ['fer', '带来；拿', 'transfer 转移 · offer 提供', 'fer = carry —— 拿过去 = 转移', '拉丁 ferre（to carry）'],
  ['fid', '信任；忠诚', 'confident 自信的 · fidelity 忠诚', 'fid = trust —— 完全信自己 = 自信', '拉丁 fides（faith）'],
  ['fin', '结束；界限', 'final 最终的 · define 定义', 'fin = end —— 划出边界 = 定义', '拉丁 finis（end）'],
  ['firm', '坚固；确定', 'confirm 确认 · firm 坚定的', 'firm = strong —— 再加固一次 = 确认', '拉丁 firmus（firm）'],
  ['flect|flex', '弯曲', 'reflect 反射 · flexible 灵活的', 'flect = bend —— 弯回来 = 反射', '拉丁 flectere（to bend）'],
  ['flu|flux', '流', 'fluent 流利的 · influence 影响', 'flu = flow —— 流进心里 = 影响', '拉丁 fluere（to flow）'],
  ['form', '形状；形成', 'formation 形成 · reform 改革', 'form = shape —— 重新塑形 = 改革', '拉丁 forma（shape）'],
  ['fort', '强；力量', 'fortress 堡垒 · effort 努力', 'fort = strong —— 使出力 = 努力', '拉丁 fortis（strong）'],
  ['frag|fract', '破碎', 'fragile 脆弱的 · fracture 骨折', 'fract = break —— 断了 = 骨折', '拉丁 frangere（to break）'],
  ['fug', '逃', 'refuge 避难所 · fugitive 逃亡者', 'fug = flee —— 逃进去的地方 = 避难所', '拉丁 fugere（to flee）'],
  ['gen', '产生；种族；种类', 'generate 产生 · genius 天才', 'gen = birth —— 天生就有 = 天才', '拉丁 genus（birth, race）'],
  ['grad|gress', '走；步', 'gradual 逐渐的 · progress 进步', 'gress = step —— 一步步往前 = 进步', '拉丁 gradi（to step）'],
  ['graph|gram', '写；画', 'photograph 照片 · program 节目', 'graph = write —— 用光写下来 = 照片', '希腊 graphein（to write）'],
  ['grat', '感谢；喜欢；恩惠', 'grateful 感激的 · congratulate 祝贺', 'grat = please —— 一起高兴 = 祝贺', '拉丁 gratus（pleasing）'],
  ['grav', '重；严重', 'gravity 重力 · grave 严重的', 'grav = heavy —— 重的东西 = 重力', '拉丁 gravis（heavy）'],
  ['greg', '群', 'gregarious 群居的 · segregate 隔离', 'greg = flock —— 从群里分开 = 隔离', '拉丁 grex（flock）'],
  ['hab|hibit', '有；持有', 'habit 习惯 · exhibit 展出', 'habit = hold —— 一直保持的东西 = 习惯', '拉丁 habere（to have）'],
  ['ject', '投掷', 'project 投射 · reject 拒绝', 'ject = throw —— 扔回去 = 拒绝', '拉丁 jacere（to throw）'],
  ['jud|jur|just', '判断；法；宣誓', 'judge 法官 · justice 正义', 'jud = judge —— 依法判断 = 正义', '拉丁 judex（judge）'],
  ['junct|join', '连接', 'junction 交叉口 · adjoin 毗连', 'junct = join —— 接起来的地方 = 交叉口', '拉丁 jungere（to join）'],
  ['lab', '劳动', 'labor 劳动 · collaborate 合作', 'lab = work —— 一起干活 = 合作', '拉丁 laborare（to work）'],
  ['lect|leg|lig', '选；读；收集', 'collect 收集 · elect 选举', 'lect = choose/read —— 挑出来 = 选举', '拉丁 legere（to choose, read）'],
  ['lev', '举起；轻', 'elevate 提升 · lever 杠杆 · levity 轻浮', 'lev = light/raise —— 变轻了就举得起来', '拉丁 levare（to raise）'],
  ['liber', '自由', 'liberty 自由 · liberal 自由的', 'liber = free —— 自由就是不被束缚', '拉丁 liber（free）'],
  ['liter', '字母；文字', 'literature 文学 · literal 字面的', 'liter = letter —— 字面的意思 = 字面义', '拉丁 littera（letter）'],
  ['loc', '地方', 'local 当地的 · locate 定位', 'loc = place —— 找到地方 = 定位', '拉丁 locus（place）'],
  ['log|logue|logy', '言语；学科', 'dialogue 对话 · biology 生物学', 'logy = 学科 —— bio（生命）+ logy = 生物学', '希腊 logos（word, study）'],
  ['loqu|locut', '说', 'eloquent 雄辩的 · colloquial 口语的', 'loqu = speak —— 说得好 = 雄辩', '拉丁 loqui（to speak）'],
  ['luc|lumin|lustr', '光；亮', 'translucent 半透明的 · illuminate 照亮', 'luc = light —— 光能透过去 = 半透明', '拉丁 lux（light）'],
  ['magn', '大', 'magnificent 壮丽的 · magnify 放大', 'magn = great —— 弄得很大 = 放大', '拉丁 magnus（great）'],
  ['man|manu', '手', 'manual 手册 · manage 管理', 'manu = hand —— 拿在手上的小册子 = 手册', '拉丁 manus（hand）'],
  ['mar|marin', '海', 'marine 海洋的 · submarine 潜艇', 'mar = sea —— 在海下面走 = 潜艇', '拉丁 mare（sea）'],
  ['mater|matr', '母', 'maternal 母亲的 · matrix 母体', 'matr = mother —— 孕育的地方 = 母体', '拉丁 mater（mother）'],
  ['med|medi', '中间', 'medium 媒介 · intermediate 中级的', 'medi = middle —— 夹在中间的 = 媒介', '拉丁 medius（middle）'],
  ['memor', '记忆', 'memory 记忆 · commemorate 纪念', 'memor = remember —— 一起记住 = 纪念', '拉丁 memor（mindful）'],
  ['ment', '心；思考', 'mental 精神的 · mention 提及', 'ment = mind —— 心里想到 = 提及', '拉丁 mens（mind）'],
  ['merg|mers', '沉；浸', 'emerge 出现 · immerse 浸入', 'merg = dip —— 从水里浮出来 = 出现', '拉丁 mergere（to dip）'],
  ['meter|metr', '测量；尺度', 'thermometer 温度计 · symmetry 对称', 'metr = measure —— 量热 = 温度计', '希腊 metron（measure）'],
  ['migr', '迁移', 'migrate 迁徙 · immigrant 移民', 'migr = move —— 挪地方 = 迁徙', '拉丁 migrare（to move）'],
  ['min', '小；少', 'minimum 最小值 · minor 次要的', 'min = small —— 小到不能再小 = 最小值', '拉丁 minus（less）'],
  ['mit|miss', '送；放', 'submit 提交 · mission 任务', 'miss = send —— 派出去的事 = 任务', '拉丁 mittere（to send）'],
  ['mob|mot|mov', '移动', 'mobile 移动的 · promote 促进', 'mot = move —— 往前推 = 促进', '拉丁 movere（to move）'],
  ['mon|monit', '警告；提醒', 'monitor 显示器 · monument 纪念碑', 'monit = warn —— 提醒你的屏幕 = 显示器', '拉丁 monere（to warn）'],
  ['mort', '死', 'mortal 凡人的 · immortal 不朽的', 'mort = death —— 会死的 = 凡人', '拉丁 mors（death）'],
  ['nat|nasc', '出生', 'native 本地的 · nation 国家', 'nat = birth —— 生在这里 = 本地人', '拉丁 nasci（to be born）'],
  ['nav', '船；航行', 'navigate 航行 · navy 海军', 'nav = ship —— 开船 = 航行', '拉丁 navis（ship）'],
  ['neg', '否；不', 'negative 否定的 · neglect 忽视', 'neg = no —— 说不 = 否定', '拉丁 negare（to deny）'],
  ['nom|nym', '名字', 'nominate 提名 · synonym 同义词', 'nym = name —— 名字一样 = 同义词', '希腊 onoma（name）'],
  ['nov', '新', 'novel 新颖的 · innovate 创新', 'nov = new —— 新的东西 = 小说（novel 原意就是「新奇的」）', '拉丁 novus（new）'],
  ['numer', '数', 'numerous 众多的 · numerical 数字的', 'numer = number —— 数不清 = 众多', '拉丁 numerus（number）'],
  ['oper', '工作', 'operate 操作 · cooperate 合作', 'oper = work —— 一起干 = 合作', '拉丁 opus（work）'],
  ['opt', '选择；看', 'option 选择 · optical 光学的', 'opt = choose/sight —— 挑一个 = 选项', '希腊 optein（to see）'],
  ['ord|ordin', '顺序；命令', 'order 顺序 · ordinary 普通的', 'ordin = order —— 按顺序排好的 = 普通的', '拉丁 ordo（order）'],
  ['par', '准备；显现', 'prepare 准备 · apparent 明显的', 'par = appear —— 看得见的 = 明显', '拉丁 parere（to appear）'],
  ['pass|pati', '感受；忍受', 'passion 激情 · patient 病人', 'pati = suffer —— 忍得住的人 = 病人', '拉丁 pati（to suffer）'],
  ['path', '感情；疾病', 'sympathy 同情 · pathology 病理学', 'path = feeling/suffering —— 一起感受 = 同情', '希腊 pathos（feeling）'],
  ['ped|pod', '脚', 'pedestrian 行人 · tripod 三脚架', 'ped = foot —— 用脚走的人 = 行人', '拉丁 pes / 希腊 pous（foot）'],
  ['pel|puls', '推；驱', 'compel 强迫 · impulse 冲动', 'puls = drive —— 从心里推你 = 冲动', '拉丁 pellere（to drive）'],
  ['pend|pens', '悬挂；称量；花费', 'depend 依赖 · expensive 昂贵的', 'pend = hang —— 挂在别人身上 = 依赖', '拉丁 pendere（to hang, weigh）'],
  ['phon', '声音', 'telephone 电话 · symphony 交响乐', 'phon = sound —— 一起发声 = 交响乐', '希腊 phone（sound）'],
  ['photo', '光', 'photograph 照片', 'photo = light —— 用光写下来 = 照片', '希腊 phos（light）'],
  ['plen|plet', '满；填满', 'complete 完成 · plenty 丰富', 'plet = fill —— 填满了 = 完成', '拉丁 plere（to fill）'],
  ['plic|ply|plex', '折叠；缠绕', 'complicated 复杂的 · multiply 乘', 'plic = fold —— 折了好多层的 = 复杂', '拉丁 plicare（to fold）'],
  ['pon|pos|pound', '放；置', 'compose 组成 · deposit 存款', 'pos = put —— 放下去的钱 = 存款', '拉丁 ponere（to put）'],
  ['popul|publ', '人民', 'popular 流行的 · public 公共的', 'popul = people —— 大家都喜欢 = 流行', '拉丁 populus（people）'],
  ['port', '携带；港口', 'transport 运输 · import 进口', 'port = carry —— 运进来 = 进口', '拉丁 portare（to carry）'],
  ['prehend|pris', '抓住', 'comprehend 理解 · prison 监狱', 'pris = seize —— 抓起来关的地方 = 监狱', '拉丁 prehendere（to seize）'],
  ['prim|prin', '第一；首要', 'primary 首要的 · principle 原则', 'prim = first —— 放在第一位的 = 首要', '拉丁 primus（first）'],
  ['priv', '私人；剥夺', 'private 私人的 · privilege 特权', 'priv = private —— 只给私人的好处 = 特权', '拉丁 privus（private）'],
  ['prob|prov', '证明；试验', 'probable 可能的 · prove 证明', 'prov = test —— 试过才知道 = 证明', '拉丁 probare（to test）'],
  ['quir|quest|quisit', '寻求；问', 'require 需要 · question 问题', 'quir = seek —— 需要就是「缺，所以去找」', '拉丁 quaerere（to seek）'],
  ['reg|rect', '统治；直；规则', 'regular 规则的 · correct 正确的', 'rect = straight —— 拉直了 = 正确', '拉丁 regere（to rule）'],
  ['rupt', '破；断', 'interrupt 打断 · bankrupt 破产的', 'rupt = break —— 把话打断 = 打断', '拉丁 rumpere（to break）'],
  ['sci', '知道', 'science 科学 · conscious 有意识的', 'sci = know —— 知道的知识 = 科学', '拉丁 scire（to know）'],
  ['sect|seg', '切；分', 'section 部分 · segment 片段', 'sect = cut —— 切下来的一块 = 部分', '拉丁 secare（to cut）'],
  ['sequ|secu|sue', '跟随', 'sequence 顺序 · pursue 追求', 'sequ = follow —— 一直跟着 = 追求', '拉丁 sequi（to follow）'],
  ['serv', '服务；保持', 'service 服务 · preserve 保存', 'serv = serve/keep —— 一直保持 = 保存', '拉丁 servare（to keep）'],
  ['sign', '记号；信号', 'signal 信号 · significant 重要的', 'sign = mark —— 有记号说明重要', '拉丁 signum（sign）'],
  ['simil|simul|sembl', '相似；一起', 'similar 相似的 · simulate 模拟', 'simil = same —— 做得像真的 = 模拟', '拉丁 similis（like）'],
  ['sist|sta|stit', '站立；稳定', 'assist 协助 · stable 稳定的', 'sta = stand —— 站得住 = 稳定', '拉丁 stare（to stand）'],
  ['solv|solut', '解开；松开', 'solve 解决 · solution 解决方案', 'solv = loosen —— 把结解开 = 解决', '拉丁 solvere（to loosen）'],
  ['son', '声音', 'sonic 声音的 · resonance 共鸣', 'son = sound —— 一起响 = 共鸣', '拉丁 sonus（sound）'],
  ['spec|spect|spic', '看', 'inspect 检查 · respect 尊重 · prospect 前景 · suspect 怀疑 · spectacle 景象', 'spect = look —— 往里看 = 检查；回头看 = 尊重；往前看 = 前景', '拉丁 specere（to look）'],
  ['spir', '呼吸；精神', 'inspire 激励 · spirit 精神', 'spir = breathe —— 给你打气 = 激励', '拉丁 spirare（to breathe）'],
  ['string|strict', '拉紧；束缚', 'strict 严格的 · restrict 限制', 'strict = tighten —— 拉紧了 = 严格', '拉丁 stringere（to tighten）'],
  ['stru|struct', '建造；堆叠', 'structure 结构 · construct 建造', 'struct = build —— 一起搭起来 = 建造', '拉丁 struere（to build）'],
  ['sum|sumpt', '拿；消耗', 'assume 假定 · consume 消费', 'sumpt = take —— 拿过来用掉 = 消费', '拉丁 sumere（to take）'],
  ['tain|ten|tent|tin', '持有；保持', 'contain 包含 · maintain 维持', 'tain = hold —— 一直拿住 = 维持', '拉丁 tenere（to hold）'],
  ['tect', '覆盖', 'protect 保护 · detect 察觉', 'tect = cover —— 盖在上面 = 保护', '拉丁 tegere（to cover）'],
  ['tend|tens|tent', '伸展；拉紧', 'extend 延伸 · tension 紧张', 'tens = stretch —— 拉紧了 = 紧张', '拉丁 tendere（to stretch）'],
  ['term', '界限；结束', 'terminal 终点 · determine 决定', 'term = limit —— 划出界限 = 决定', '拉丁 terminus（boundary）'],
  ['terr', '土地', 'territory 领土 · terrain 地形', 'terr = earth —— 一块地 = 领土', '拉丁 terra（earth）'],
  ['test', '证明；作证', 'testify 证明 · protest 抗议', 'test = witness —— 站出来作证 = 证明', '拉丁 testis（witness）'],
  ['text', '编织', 'textile 纺织品 · context 上下文', 'text = weave —— 前后编在一起 = 上下文', '拉丁 texere（to weave）'],
  ['therm', '热', 'thermometer 温度计 · thermal 热的', 'therm = heat —— 量热的表 = 温度计', '希腊 therme（heat）'],
  ['tort', '扭；弯', 'distort 扭曲 · torture 折磨', 'tort = twist —— 扭歪了 = 扭曲', '拉丁 torquere（to twist）'],
  ['tract', '拉；拖', 'attract 吸引 · tractor 拖拉机', 'tract = pull —— 往自己这边拉 = 吸引', '拉丁 trahere（to pull）'],
  ['trib', '给；分配', 'contribute 贡献 · distribute 分配', 'trib = give —— 一起给出 = 贡献', '拉丁 tribuere（to give）'],
  ['trud|trus', '推', 'intrude 侵入 · protrude 突出', 'trud = push —— 硬推进去 = 侵入', '拉丁 trudere（to push）'],
  ['turb', '搅动；混乱', 'disturb 打扰 · turbulent 动荡的', 'turb = stir —— 搅得不安生 = 打扰', '拉丁 turbare（to disturb）'],
  ['vac|van|void', '空', 'vacant 空的 · vanish 消失', 'vac = empty —— 空着没人 = 空置', '拉丁 vacare（to be empty）'],
  ['vad|vas', '走；行', 'invade 入侵 · evasion 逃避', 'vad = go —— 走进去 = 入侵', '拉丁 vadere（to go）'],
  ['val|vail', '价值；强壮', 'value 价值 · prevail 盛行', 'val = strong/worth —— 比谁都强 = 盛行', '拉丁 valere（to be strong）'],
  ['ven|vent', '来', 'invent 发明 · prevent 预防', 'vent = come —— 提前来挡住 = 预防', '拉丁 venire（to come）'],
  ['ver|veri', '真实', 'verify 核实 · verdict 裁决', 'ver = true —— 查明真假 = 核实', '拉丁 verus（true）'],
  ['verb', '词；话', 'verbal 口头的 · proverb 谚语', 'verb = word —— 口头的 = 用话说的', '拉丁 verbum（word）'],
  ['vert|vers', '转', 'convert 转换 · reverse 颠倒', 'vers = turn —— 转过来 = 颠倒', '拉丁 vertere（to turn）'],
  ['vi|via', '路；道', 'deviate 偏离 · previous 以前的', 'vi = way —— 离开正道 = 偏离', '拉丁 via（way）'],
  ['vid|vis', '看', 'video 视频 · visible 可见的', 'vis = see —— 看得见 = 可见', '拉丁 videre（to see）'],
  ['vinc|vict', '征服；胜', 'victory 胜利 · convince 说服', 'vict = conquer —— 把你说服 = 征服你', '拉丁 vincere（to conquer）'],
  ['viv|vit', '生命；活', 'survive 幸存 · vital 至关重要的', 'viv = live —— 活下来 = 幸存', '拉丁 vivere（to live）'],
  ['voc|vok', '叫；声音', 'vocal 声音的 · invoke 援引', 'voc = call —— 把名字叫出来 = 援引', '拉丁 vocare（to call）'],
  ['vol|volunt', '意愿', 'volunteer 志愿者 · voluntary 自愿的', 'volunt = will —— 自己愿意去 = 志愿者', '拉丁 velle（to wish）'],
  ['volv|volut', '滚；转', 'involve 涉及 · revolution 革命', 'volv = roll —— 卷进去 = 涉及', '拉丁 volvere（to roll）'],
  /* ⚠️ 下面这些是**拿真实单词试出来的缺口** ✗ —— 拆 `description` / `impossible` /
     `prosperity` / `bilingual` 时才发现库里没有 ✓（这就是「拿真数据跑」的价值 ✓）。 */
  ['scrib|script', '写', 'describe 描述 · manuscript 手稿 · subscribe 订阅', 'script = write —— 手写出来的东西 = 手稿', '拉丁 scribere（to write）'],
  ['poss|pot', '能力；能', 'possible 可能的 · potential 潜在的 · potent 有力的', 'pot = able —— 有能力做到 = 可能', '拉丁 posse（to be able）'],
  ['sper|spair', '希望', 'prosperity 繁荣 · desperate 绝望的', 'sper = hope —— 完全没有希望了 = 绝望', '拉丁 spes（hope）'],
  ['soci', '同伴；社会', 'social 社会的 · associate 联合', 'soci = companion —— 一群人凑在一起 = 社会', '拉丁 socius（companion）'],
  ['civ', '公民；城市', 'civil 公民的 · civilian 平民', 'civ = citizen —— 公民之间的 = 民事的', '拉丁 civis（citizen）'],
  ['tempor', '时间', 'temporary 临时的 · contemporary 当代的', 'tempor = time —— 只在一段时间里有效 = 临时', '拉丁 tempus（time）'],
  ['lingu', '语言；舌头', 'bilingual 双语的 · linguistics 语言学', 'lingu = tongue —— 两条舌头 = 双语', '拉丁 lingua（tongue）'],
  ['urb', '城市', 'urban 城市的 · suburb 郊区', 'urb = city —— 主城外面的那片 = 郊区', '拉丁 urbs（city）'],
  ['patr', '父', 'patriot 爱国者 · patron 赞助人', 'patr = father —— 把国家当父亲 = 爱国者', '拉丁 pater（father）'],
  ['medic', '医治', 'medical 医学的 · medication 药物治疗', 'medic = heal —— 治病的 = 医学的', '拉丁 medicus（physician）'],
  ['mut', '改变', 'mutual 相互的 · mutation 突变', 'mut = change —— 变了 = 突变', '拉丁 mutare（to change）'],
  ['sent|sens', '感觉', 'sense 感觉 · consent 同意 · sensitive 敏感的', 'sens = feel —— 一起有感觉 = 同意', '拉丁 sentire（to feel）'],
];

/* ── 展开成条目 ✓ ───────────────────────────────────────────────────────── */
const TYPE_NAME = { pre: '前缀', root: '词根', suf: '后缀' };
function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, '');
}
/* `inspect 检查 · respect 尊重` → `[{ w:'inspect', zh:'检查' }, …]` ✓ */
function parseEg(s) {
  return String(s || '').split('·').map((x) => {
    const t = x.trim();
    if (!t) return null;
    const m = /^([A-Za-z][A-Za-z'’\- ]*?)\s+(.+)$/.exec(t);
    return m ? { w: m[1].trim(), zh: m[2].trim() } : { w: t, zh: '' };
  }).filter(Boolean);
}
function build(raw, t) {
  return raw.map((r) => {
    const forms = String(r[0]).split('|').map(norm).filter(Boolean);
    return {
      k: forms[0], alt: forms.slice(1), t,
      m: String(r[1] || '').trim(),
      eg: parseEg(r[2]),
      mnem: String(r[3] || '').trim(),
      from: String(r[4] || '').trim(),
    };
  });
}
/* ⚠️ 顺序很重要 ✗：**先长后短** ✓ —— 拆词时才能贪心吃掉最长的那个 ✓
   （`re` 和 `retro` 都在表里 ✓，先匹配 `retro` 才不会把 retrospect 拆成 re+trospect ✗）。 */
const ALL = build(PRE_RAW, 'pre').concat(build(ROOT_RAW, 'root')).concat(build(SUF_RAW, 'suf'))
  .sort((a, b) => b.k.length - a.k.length);
const BY_KEY = new Map();
ALL.forEach((e) => { [e.k].concat(e.alt).forEach((f) => { if (!BY_KEY.has(f)) BY_KEY.set(f, e); }); });

/* ── 对外 API ✓ ─────────────────────────────────────────────────────────── */
function all() { return ALL.slice(); }
function byType(t) { return ALL.filter((e) => e.t === t); }
function byKey(k) { return BY_KEY.get(norm(k)) || null; }
/* ★ 同形的**所有**条目 ✓ —— ⚠️ 词根**确实会同形** ✗，这不是数据错误 ✓：
   `cid` 既是「落下」（accident ✓）又是「切」（decide ✓）、
   `cur` 既是「跑」（current ✓）又是「关心」（cure ✓）、
   `tent` 既是「持有」（content ✓）又是「伸展」（tent ✓）。
   → 查询时**全部列出来** ✓（这正是学习者该知道的事 ✓），
     而不是假装只有一个 ✓（`byKey` 只给第一个 ✓，用来跳转 ✓）。 */
function sameKey(k) {
  const f = norm(k);
  return ALL.filter((e) => [e.k].concat(e.alt).indexOf(f) >= 0);
}
function typeName(t) { return TYPE_NAME[t] || t; }
/* 展示用 ✓ —— ⚠️ **必须能传「实际匹配到的那个变体」** ✗：
   `in|im|il|ir` 这条的规范形是 `il` ✓，但 `inspect` 里匹配到的是 `in` ✓ ——
   只按规范形显示的话会印出 `il- + spect` ✗✗（第一版就是这么错的 ✓，实测抓到的 ✓）。
   前缀 `re-` ✓、后缀 `-tion` ✓、词根 `spect` ✓ */
function show(e, form) {
  if (!e) return '';
  const f = form || e.k;
  return e.t === 'pre' ? (f + '-') : e.t === 'suf' ? ('-' + f) : f;
}
function showAll(e) {
  if (!e) return '';
  const list = [e.k].concat(e.alt);
  return list.map((f) => (e.t === 'pre' ? f + '-' : e.t === 'suf' ? '-' + f : f)).join(' / ');
}
/* ★ 搜索 ✓ —— 形 / 义 / 例词 / 巧记 都能搜 ✓（用户要「方便我查询」✓） */
function search(q, limit) {
  const s = String(q == null ? '' : q).trim().toLowerCase();
  if (!s) return ALL.slice(0, limit || 200);
  const bare = norm(s);
  const hit = [];
  ALL.forEach((e) => {
    let sc = 0;
    const forms = [e.k].concat(e.alt);
    if (bare && forms.indexOf(bare) >= 0) sc = 100;                       /* 完全就是这个词根 ✓ */
    else if (bare && forms.some((f) => f.indexOf(bare) === 0)) sc = 80;   /* 前缀匹配 ✓ */
    else if (e.m.toLowerCase().indexOf(s) >= 0) sc = 60;                  /* 含义命中 ✓ */
    else if (e.eg.some((x) => x.w.toLowerCase() === s)) sc = 70;          /* 例词正好是它 ✓ */
    else if (e.eg.some((x) => x.w.toLowerCase().indexOf(s) >= 0)) sc = 40;/* 例词里含 ✓ */
    else if (forms.some((f) => f.indexOf(bare) >= 0)) sc = 30;            /* 形里含 ✓ */
    else if (e.mnem.toLowerCase().indexOf(s) >= 0) sc = 20;
    if (sc) hit.push({ e, sc });
  });
  hit.sort((a, b) => b.sc - a.sc || a.e.k.length - b.e.k.length || (a.e.k < b.e.k ? -1 : 1));
  return hit.slice(0, limit || 60).map((x) => x.e);
}
/* 同根词：这个条目例词里**共享同一词根**的其它条目 ✓（用于「词族」那一支 ✓） */
function family(e) {
  if (!e) return [];
  const out = [];
  const seen = new Set();
  ALL.forEach((o) => {
    if (o === e || o.t !== e.t) return;
    if (out.length >= 12) return;
    const share = [o.k].concat(o.alt).some((f) => [e.k].concat(e.alt).indexOf(f) >= 0);
    if (share && !seen.has(o.k)) { seen.add(o.k); out.push(o); }
  });
  return out;
}

/* ── ★★ 拆词 ✓ ────────────────────────────────────────────────────────────
   「inspect」→ 前缀 `in-`（向内）+ 词根 `spect`（看）✓

   ⚠️⚠️ **英语不是拼积木** ✗✗ —— 我第一版是「贪心吃掉最长的词根」✓，
      结果 `disagree` 被拆成 `di- + act + -ee` ✗✗（看着特别像真的 ✓，
      但完全是胡说 ✓）。这种**自信的错误答案**比「查不到」更坏 ✗ ——
      用户会照着背 ✓，而且他没法发现 ✗（和「音标背错」是同一类事故 ✓）。

   ★ 所以三条硬规矩 ✓：
     ① **必须连续覆盖** ✗ —— 拆出来的三块**拼起来要等于原词** ✓
        （只允许 ≤2 个字母说不清 ✓，超了就**拒绝回答** ✓，不硬凑 ✗）。
     ② 允许两种**语言事实** ✓：
        · **同化** ✓（`sub+spect` → `suspect` ✓，前缀尾字母和词根首字母重合 ✓）；
        · **连接元音** ✓（`spect` + `acle` → `spectacle` ✓）。
     ③ 允许**两个词根** ✓（`biology` = `bio` + `log` + `y` ✓、
        `photograph` = `photo` + `graph` ✓ —— 这类词很常见 ✓）
        和**两个后缀** ✓（`international` = `inter` + `nat` + `ion` + `al` ✓）。

   ⚠️ 拆不出来就**老实返回 null** ✓ —— 前端会说「库里没这个词根，
      让 AI 拆一下试试」✗，而不是编一个 ✗。 */

/* 在 `s` 里找「**顶着最前面**」的词根组合 ✓ —— 返回所有可能，由调用方挑 ✓ */
function rootsAt(s) {
  const single = [];
  byType('root').forEach((e) => {
    [e.k].concat(e.alt).forEach((f) => { if (s.indexOf(f) === 0) single.push({ e, form: f }); });
  });
  single.sort((a, b) => b.form.length - a.form.length);
  const out = [];
  single.forEach((r1) => {
    out.push([r1]);
    const rest = s.slice(r1.form.length);
    if (rest.length < 2) return;
    byType('root').forEach((e2) => {
      [e2.k].concat(e2.alt).forEach((f2) => { if (rest.indexOf(f2) === 0) out.push([r1, { e: e2, form: f2 }]); });
    });
  });
  return out;
}

function split(word) {
  const w = norm(word);
  if (w.length < 3) return null;

  /* ① 前缀候选 ✓（含空 ✓，先长后短 ✓） */
  const preCands = [{ form: '', e: null }];
  byType('pre').forEach((e) => {
    [e.k].concat(e.alt).forEach((f) => {
      if (w.indexOf(f) === 0 && w.length - f.length >= 2) preCands.push({ form: f, e });
    });
  });
  preCands.sort((a, b) => b.form.length - a.form.length);

  /* ② 后缀候选 ✓（含空 ✓；单后缀 + 双后缀 ✓ —— `international` 的 `-ion` + `-al` ✓）
     ⚠️⚠️ 双后缀**不能**只从「匹配词尾的后缀」里挑 ✗✗ —— 实测栽过 ✓：
        `international` 的词尾是 `-al` ✓，`-ion` **根本不在词尾** ✗（它在 `-al` 前面 ✓）→
        只从词尾候选里配的话**永远配不出** `ional` ✗ → 整词拆不出来 ✗。
        → 单后缀从**词尾**挑 ✓，双后缀从**全表**里两两拼 ✓ 再验词尾 ✓。 */
  const sufForms = [];
  byType('suf').forEach((e) => { [e.k].concat(e.alt).forEach((f) => sufForms.push({ form: f, e })); });
  const single = sufForms.filter((s) => w.slice(-s.form.length) === s.form && w.length - s.form.length >= 2);
  single.sort((a, b) => b.form.length - a.form.length);
  const sufCands = [{ form: '', parts: [] }];
  single.forEach((s) => sufCands.push({ form: s.form, parts: [{ e: s.e, form: s.form }] }));
  sufForms.forEach((s1) => sufForms.forEach((s2) => {
    const f = s1.form + s2.form;
    if (f.length > 9 || w.slice(-f.length) !== f || w.length - f.length < 3) return;
    if (sufCands.some((x) => x.form === f)) return;
    sufCands.push({ form: f, parts: [{ e: s1.e, form: s1.form }, { e: s2.e, form: s2.form }] });
  }));

  let best = null;
  const consider = (P, S, roots, rest) => {
    /* ★★ 规矩① 加强版 ✓：说不清的字母**必须全是元音** ✗✗ ——
       实测抓到的 ✓：`disagree` 被拆成 `dis- + ag（做）+ -ee` ✓，
       还剩一个 `r` 说不清 ✓ —— 按「≤2 个字母」放行的话它**过了** ✗✗，
       而正确答案是 `dis- + agree`（`agree` 不是词根 ✓，该老实说不知道 ✓）。
       → 残渣是**辅音** → 几乎一定是**硬凑** ✗ → 拒绝 ✓。
         真正合法的残渣都是**元音** ✓（`involve` = `in`+`volv`+`e` 那个 `e` ✓、
         `telephone` = `tele`+`phon`+`e` ✓ —— 连接 / 不发音的元音 ✓）。 */
    if (rest.length > 2) return;
    if (!/^[aeiouy]*$/.test(rest)) return;
    const rootLen = roots.reduce((n, r) => n + r.form.length, 0);
    const cover = w.length - rest.length;
    const score = cover * 10 + rootLen * 3 + roots.length * 4 + (P.form ? 2 : 0) + (S.form ? 2 : 0);
    if (best && score <= best.score) return;
    best = { score, word: w, P, S, roots, rest, cover };
  };
  preCands.forEach((P) => {
    sufCands.forEach((S) => {
      const mid = w.slice(P.form.length, w.length - S.form.length);
      if (mid.length < 2) return;
      /* 三种对法 ✓：原样 ✓ / 前缀尾字母与词根首字母**重合**（同化 ✓，`sub+spect`→`suspect` ✓）/
         去掉一个**连接元音** ✓（`spect`+`acle`→`spectacle` ✓） */
      const tries = [{ s: mid, drop: 0 }];
      if (P.form) tries.push({ s: P.form.slice(-1) + mid, drop: 1 });
      if (/[aeiouy]/.test(mid[0]) && mid.length > 3) tries.push({ s: mid.slice(1), drop: 1 });
      tries.forEach((t) => {
        rootsAt(t.s).forEach((roots) => {
          const used = roots.reduce((n, r) => n + r.form.length, 0) - t.drop;
          consider(P, S, roots, mid.slice(Math.max(0, used)));
        });
      });
    });
  });
  if (!best) return splitStem(w, preCands, sufCands);          /* ★ 找不到词根 → 退成「前缀 + 词干 + 后缀」✓ */

  const rootLen = best.roots.reduce((n, r) => n + r.form.length, 0);
  const conf = best.rest === '' ? 'full' : 'part';
  return {
    word: w,
    pre: best.P.e, preForm: best.P.form,
    roots: best.roots, suf: best.S.parts,
    rest: best.rest,
    confidence: conf,
    cover: best.cover,
  };
}

/* ── ★ 兜底：找不到词根时，退成「前缀 + **词干** + 后缀」✓ ────────────────
   实测发现 ✗：一大批常用词**没有词根**可拆 ✓ ——
   `unhappy` = `un-` + `happy` ✓、`disagree` = `dis-` + `agree` ✓、
   `beautiful` = `beauti` + `-ful` ✓、`carefully` = `careful` + `-ly` ✓、
   `deforest` = `de-` + `forest` ✓。
   这些词**照样值得拆** ✓（用户就是想知道「哪块是前缀、哪块是后缀」✓），
   直接说「不知道」反而没用 ✗。

   ⚠️⚠️ 但必须**明说是「词干」** ✗✗，绝不能混进「词根」那一类 ✗ ——
      `happy` / `agree` / `forest` 是**独立的词** ✓，不是拉丁词根 ✓。
      混在一起的话，用户会以为「happy 是个词根」✗，越记越乱 ✗。

   ⚠️⚠️ 挑哪个组合，**打分规则很讲究** ✗✗ —— 我第一版是「词缀字母多者胜」✓，
      结果 `beautiful` 被拆成 `be- + auti + -ful` ✗✗（硬凑出一个 `be-` ✓）、
      `disagree` 被拆成 `dis- + agr + -ee` ✗（硬凑出一个 `-ee` ✓）。
      → 改成 **① 词缀个数越少越好 ✓ → ② 同样少时词缀越长越好 ✓ → ③ 再比词干长 ✓**：
        · `beautiful` → 一个词缀 → `-ful`(3) 胜过 `be-`(2) ✓ → `beauti` + `-ful` ✓ 对 ✓
        · `unhappy` → `un-`(2) 胜过 `-y`(1) ✓ → `un-` + `happy` ✓ 对 ✓
        · `disagree` → `dis-`(3) 胜过 `-ee`(2) ✓ → `dis-` + `agree` ✓ 对 ✓
        · `carefully` → `-ly`(2) 胜过 `-y`(1) ✓ → `careful` + `-ly` ✓ 对 ✓
   ⚠️ 两个词缀只在**足够长的词**上才允许 ✗（< 10 字母只取一个 ✓）——
      短词上凑两个，多半是硬凑 ✓（`disagree` 只有 8 个字母 ✓，不该拆成三段 ✓）。
   ⚠️⚠️ **弱前缀**在兜底里**不参与** ✗✗ —— `be-` / `a-` / `en-` / `em-` 这几个
      最容易硬凑 ✓：`beautiful` 会被拆成 `be- + auti + -ful` ✗✗、
      `abc` 会被拆成 `a- + bc` ✗。它们**留在词库里** ✓（`belittle` / `asleep`
      确实用得上 ✓，用户能查到 ✓），只是**兜底时不拿它们去切** ✗。 */
const WEAK_PRE = ['be', 'a', 'en', 'em'];
function cmpRank(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}
function splitStem(w, preCands, sufCands) {
  const strong = preCands.filter((p) => !p.form || WEAK_PRE.indexOf(p.form) < 0);
  let best = null;
  strong.forEach((P) => {
    sufCands.forEach((S) => {
      const n = (P.form ? 1 : 0) + (S.form ? 1 : 0);
      if (n === 0) return;                                     /* 一个词缀都没有 → 不叫拆解 ✓ */
      if (n === 2 && w.length < 10) return;
      const mid = w.slice(P.form.length, w.length - S.form.length);
      if (mid.length < 2) return;
      const affix = P.form.length + S.form.length;
      /* ⚠️ 第 4 个排序键是「**宁可不剥前缀**」✗ —— 实测 `arrival` 会拆成
         `ar- + rival` ✗（`ar` 是 `ad` 同化族的一员 ✓，最爱硬凑 ✓），
         而正确答案是 `arriv` + `-al` ✓ —— 两者前三个键**完全一样** ✓，
         只能靠「同样好时**不剥前缀**」来定 ✓。 */
      const rank = [-n, affix, mid.length, P.form ? 1 : 0];
      if (best && cmpRank(rank, best.rank) <= 0) return;
      best = { rank, P, S, stem: mid, affix };
    });
  });
  if (!best) return null;
  /* ★ 选了后缀之后，再从词干**前面**剥一个真前缀 ✓ ——
     `unhappiness` → 后缀 `-ness` → 词干 `unhappi` ✓ → 再剥出 `un-` ✓
     （弱前缀不剥 ✓，所以 `beauti` 不会被剥成 `auti` ✓）。 */
  let pre = best.P;
  let stem = best.stem;
  if (!pre.form) {
    const hit = strong.filter((p) => p.form && stem.indexOf(p.form) === 0 && stem.length - p.form.length >= 3)
      .sort((a, b) => b.form.length - a.form.length)[0];
    if (hit) { pre = hit; stem = stem.slice(hit.form.length); }
  }
  return {
    word: w,
    pre: pre.e, preForm: pre.form,
    roots: [], suf: best.S.parts,
    stem,
    rest: '',
    confidence: 'stem',
    cover: pre.form.length + stem.length + best.S.form.length,
  };
}
/* 拆解结果 → 一段能读的文字 ✓（`in-（向内）+ spect（看）` ✓） */
function explain(sp) {
  if (!sp) return '';
  const seg = [];
  if (sp.pre) seg.push(show(sp.pre, sp.preForm) + '（' + sp.pre.m + '）');
  sp.roots.forEach((r) => seg.push(show(r.e, r.form) + '（' + r.e.m + '）'));
  /* ⚠️ 词干要**明说是词干** ✗ —— 它不是词根 ✓（`happy` / `agree` / `forest` ✓） */
  if (sp.stem) seg.push(sp.stem + '（词干）');
  sp.suf.forEach((s) => seg.push(show(s.e, s.form) + '（' + s.e.m + '）'));
  return seg.join(' + ');
}
function stats() {
  const n = (t) => byType(t).length;
  return { total: ALL.length, pre: n('pre'), root: n('root'), suf: n('suf') };
}

const LW_ROOTS_API = {
  all, byType, byKey, sameKey, search, family, split, explain, stats,
  show, showAll, typeName, norm, TYPE_NAME,
  PRE: () => byType('pre'), ROOT: () => byType('root'), SUF: () => byType('suf'),
};
/* ★★ 这个模块是**双栖**的 ✓ —— 服务端 `require` 拿到 ✓，浏览器里挂到 `window.LW_ROOTS` ✓。
   ⚠️ 本文件**不能**有顶层副作用 ✗、**不能** require 别的东西 ✗
      （它在浏览器里是被 `<script type="module">` 直接加载的 ✓）。 */
if (typeof module !== 'undefined' && module.exports) module.exports = LW_ROOTS_API;
if (typeof window !== 'undefined') window.LW_ROOTS = LW_ROOTS_API;
