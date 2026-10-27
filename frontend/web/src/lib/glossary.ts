/**
 * Football terms that Azure AI Translator gets wrong on their own: a lone "Shots" becomes photographs, "pen" a writing
 * pen, "Away" a direction and "Formation" education. The page translator uses these before asking Translator. A term
 * is matched exactly, or with its first letter capitalised ("away" → "Away").
 *
 * Columns: es, fr, de, pt, it, nl, ar, hi, ja, zh-Hans, sw.
 */
const LANGS = ["es", "fr", "de", "pt", "it", "nl", "ar", "hi", "ja", "zh-Hans", "sw"] as const;

const TERMS: Record<string, readonly [string, string, string, string, string, string, string, string, string, string, string]> = {
  // Provenance badges: REAL is a recorded result, MODEL comes from Regista's synthetic events
  "REAL": ["REAL", "RÉEL", "ECHT", "REAL", "REALE", "ECHT", "حقيقي", "वास्तविक", "実データ", "真实", "HALISI"],
  "MODEL": ["MODELO", "MODÈLE", "MODELL", "MODELO", "MODELLO", "MODEL", "نموذج", "मॉडल", "モデル", "模型", "MODELI"],

  // Navigation and pages
  "Matches": ["Partidos", "Matchs", "Spiele", "Partidas", "Partite", "Wedstrijden", "المباريات", "मैच", "試合", "比赛", "Mechi"],
  "Matchday": ["Jornada", "Jour de match", "Spieltag", "Dia de jogo", "Giornata", "Speeldag", "يوم المباراة", "मैच का दिन", "マッチデー", "比赛日", "Siku ya mechi"],
  "Tactics": ["Táctica", "Tactique", "Taktik", "Tática", "Tattica", "Tactiek", "التكتيك", "रणनीति", "戦術", "战术", "Mbinu"],
  "Ask": ["Preguntar", "Demander", "Fragen", "Perguntar", "Chiedi", "Vragen", "اسأل", "पूछें", "質問", "提问", "Uliza"],
  "Ask Regista": ["Pregunta a Regista", "Demander à Regista", "Regista fragen", "Pergunte ao Regista", "Chiedi a Regista", "Vraag Regista", "اسأل Regista", "Regista से पूछें", "Registaに質問", "询问 Regista", "Uliza Regista"],
  "Regista home": ["Inicio de Regista", "Accueil Regista", "Regista-Startseite", "Início do Regista", "Home di Regista", "Regista-startpagina", "الصفحة الرئيسية لـ Regista", "Regista होम", "Registaホーム", "Regista 首页", "Mwanzo wa Regista"],
  "Recap": ["Resumen", "Résumé", "Rückblick", "Resumo", "Riepilogo", "Samenvatting", "الملخص", "सारांश", "振り返り", "赛后回顾", "Muhtasari"],
  "Studio": ["Estudio", "Studio", "Studio", "Estúdio", "Studio", "Studio", "الاستوديو", "स्टूडियो", "スタジオ", "演播室", "Studio"],
  "Dugout": ["Banquillo", "Banc de touche", "Trainerbank", "Banco de reservas", "Panchina", "Dug-out", "دكة البدلاء", "डगआउट", "ベンチ", "教练席", "Benchi la ufundi"],
  "Scouting": ["Ojeo", "Recrutement", "Scouting", "Observação", "Scouting", "Scouting", "الكشافة", "स्काउटिंग", "スカウティング", "球探", "Utafutaji vipaji"],
  "Scouting report": ["Informe de ojeo", "Rapport de recrutement", "Scouting-Bericht", "Relatório de observação", "Report di scouting", "Scoutingrapport", "تقرير الكشافة", "स्काउटिंग रिपोर्ट", "スカウティングレポート", "球探报告", "Ripoti ya utafutaji vipaji"],
  "Data Forge": ["Forja de datos", "Forge de données", "Datenschmiede", "Forja de dados", "Fucina dei dati", "Datasmidse", "مصنع البيانات", "डेटा फ़ोर्ज", "データフォージ", "数据工坊", "Kiwanda cha data"],
  "Primary": ["Principal", "Principal", "Hauptnavigation", "Principal", "Principale", "Hoofdmenu", "الرئيسية", "मुख्य", "メイン", "主导航", "Kuu"],
  "Search players": ["Buscar jugadores", "Rechercher des joueurs", "Spieler suchen", "Buscar jogadores", "Cerca giocatori", "Spelers zoeken", "ابحث عن لاعبين", "खिलाड़ी खोजें", "選手を検索", "搜索球员", "Tafuta wachezaji"],

  // Personas
  "Persona": ["Perfil", "Profil", "Persona", "Perfil", "Profilo", "Profiel", "الشخصية", "व्यक्तित्व", "ペルソナ", "角色", "Mtindo"],
  "Casual": ["Aficionado", "Grand public", "Gelegenheitsfan", "Casual", "Tifoso", "Fan", "مشجع", "सामान्य", "ライト", "休闲", "Shabiki"],
  "Analyst": ["Analista", "Analyste", "Analyst", "Analista", "Analista", "Analist", "محلل", "विश्लेषक", "アナリスト", "分析师", "Mchambuzi"],
  "Kids": ["Niños", "Enfants", "Kinder", "Crianças", "Bambini", "Kinderen", "أطفال", "बच्चे", "キッズ", "儿童", "Watoto"],
  "Fantasy": ["Fantasy", "Fantasy", "Fantasy", "Fantasy", "Fantacalcio", "Fantasy", "الفانتازي", "फ़ैंटेसी", "ファンタジー", "梦幻足球", "Fantasy"],
  "Accessible": ["Accesible", "Accessible", "Barrierefrei", "Acessível", "Accessibile", "Toegankelijk", "سهل الوصول", "सुलभ", "アクセシブル", "无障碍", "Inayofikika"],
  "Broadcaster": ["Emisora", "Diffuseur", "Sender", "Emissora", "Emittente", "Omroep", "المذيع", "प्रसारक", "放送局", "转播方", "Mtangazaji"],
  "Social": ["Redes sociales", "Réseaux sociaux", "Social Media", "Redes sociais", "Social", "Sociale media", "التواصل الاجتماعي", "सोशल", "ソーシャル", "社交媒体", "Mitandao ya kijamii"],

  // Match terms
  "Home": ["Local", "Domicile", "Heim", "Mandante", "Casa", "Thuis", "صاحب الأرض", "घरेलू", "ホーム", "主队", "Nyumbani"],
  "Away": ["Visitante", "Extérieur", "Auswärts", "Visitante", "Trasferta", "Uit", "الضيف", "मेहमान", "アウェー", "客队", "Ugenini"],
  "Neutral": ["Neutral", "Neutre", "Neutral", "Neutro", "Neutro", "Neutraal", "محايد", "तटस्थ", "中立", "中立场地", "Uwanja huru"],
  "Friendly": ["Amistoso", "Match amical", "Freundschaftsspiel", "Amistoso", "Amichevole", "Vriendschappelijk", "ودية", "दोस्ताना मैच", "親善試合", "友谊赛", "Mechi ya kirafiki"],
  "Formation": ["Formación", "Système de jeu", "Aufstellung", "Formação", "Modulo", "Opstelling", "التشكيلة", "फ़ॉर्मेशन", "フォーメーション", "阵型", "Mpangilio"],
  "Shape": ["Dibujo táctico", "Organisation", "Grundordnung", "Desenho tático", "Assetto", "Formatie", "الشكل التكتيكي", "संरचना", "陣形", "阵型", "Umbo la timu"],
  "Shape change": ["Cambio de dibujo", "Changement d'organisation", "Systemwechsel", "Mudança de desenho", "Cambio di assetto", "Formatiewissel", "تغيير الشكل التكتيكي", "संरचना में बदलाव", "陣形変更", "阵型变化", "Mabadiliko ya umbo"],
  "Goal": ["Gol", "But", "Tor", "Gol", "Gol", "Doelpunt", "هدف", "गोल", "ゴール", "进球", "Bao"],
  "Goals": ["Goles", "Buts", "Tore", "Gols", "Gol", "Doelpunten", "الأهداف", "गोल", "ゴール", "进球", "Mabao"],
  "Recent goals": ["Goles recientes", "Buts récents", "Letzte Tore", "Gols recentes", "Gol recenti", "Recente doelpunten", "أهداف حديثة", "हाल के गोल", "最近のゴール", "近期进球", "Mabao ya karibuni"],
  "Of his goals": ["de sus goles", "de ses buts", "seiner Tore", "dos seus gols", "dei suoi gol", "van zijn doelpunten", "من أهدافه", "उसके गोलों का", "の得点割合", "占其进球", "ya mabao yake"],
  "Goals recorded": ["Goles registrados", "Buts enregistrés", "Erzielte Tore", "Gols registrados", "Gol registrati", "Geregistreerde doelpunten", "الأهداف المسجلة", "दर्ज गोल", "記録されたゴール", "记录的进球", "Mabao yaliyorekodiwa"],
  "Goals per match": ["Goles por partido", "Buts par match", "Tore pro Spiel", "Gols por partida", "Gol a partita", "Doelpunten per wedstrijd", "الأهداف في المباراة", "प्रति मैच गोल", "1試合あたりのゴール", "场均进球", "Mabao kwa mechi"],
  "Goals against elite opposition": ["goles contra rivales de élite", "buts contre l'élite", "Tore gegen Topgegner", "gols contra adversários de elite", "gol contro avversari d'élite", "doelpunten tegen topteams", "أهداف أمام نخبة المنافسين", "शीर्ष विरोधियों के खिलाफ गोल", "強豪相手のゴール", "对强队进球", "mabao dhidi ya wapinzani bora"],
  "Shots": ["Tiros", "Tirs", "Schüsse", "Finalizações", "Tiri", "Schoten", "التسديدات", "शॉट", "シュート", "射门", "Mashuti"],
  "Off target": ["Fuera", "Non cadré", "Daneben", "Para fora", "Fuori dallo specchio", "Naast", "خارج المرمى", "निशाने से बाहर", "枠外", "射偏", "Nje ya lango"],
  "Saves": ["Paradas", "Arrêts", "Paraden", "Defesas", "Parate", "Reddingen", "التصديات", "बचाव", "セーブ", "扑救", "Kuokoa"],
  "Saved": ["Parado", "Arrêté", "Gehalten", "Defendido", "Parato", "Gestopt", "تم التصدي", "बचाया गया", "セーブ", "被扑出", "Liliokolewa"],
  "Post": ["Poste", "Poteau", "Pfosten", "Trave", "Palo", "Paal", "القائم", "पोस्ट", "ポスト", "门柱", "Mwamba"],
  "Conceded": ["Encajados", "Encaissés", "Gegentore", "Sofridos", "Subiti", "Tegen", "استقبلت", "खाए", "失点", "失球", "Yaliyofungwa"],
  "Draw": ["Empate", "Match nul", "Unentschieden", "Empate", "Pareggio", "Gelijkspel", "تعادل", "ड्रॉ", "引き分け", "平局", "Sare"],
  "Draws": ["Empates", "Nuls", "Unentschieden", "Empates", "Pareggi", "Gelijke spelen", "التعادلات", "ड्रॉ", "引き分け", "平局", "Sare"],
  "Draw rate": ["Tasa de empates", "Taux de nuls", "Remisquote", "Taxa de empates", "Percentuale di pareggi", "Percentage gelijke spelen", "نسبة التعادل", "ड्रॉ दर", "引き分け率", "平局率", "Kiwango cha sare"],
  "Wins": ["Victorias", "Victoires", "Siege", "Vitórias", "Vittorie", "Overwinningen", "الانتصارات", "जीत", "勝利", "胜场", "Ushindi"],
  "Win %": ["% de victorias", "% de victoires", "Siegquote", "% de vitórias", "% vittorie", "Winst %", "نسبة الفوز", "जीत %", "勝率", "胜率", "% ya ushindi"],
  "Head to head": ["Cara a cara", "Face-à-face", "Direkter Vergleich", "Confronto direto", "Scontri diretti", "Onderling", "المواجهات المباشرة", "आमने-सामने", "直接対決", "交锋记录", "Ana kwa ana"],
  "Giant-killing": ["Batacazo", "Exploit", "Sensation", "Zebra", "Impresa", "Stunt", "مفاجأة كبرى", "बड़ा उलटफेर", "番狂わせ", "爆冷", "Mshangao mkubwa"],
  "Generate match": ["Generar partido", "Générer le match", "Spiel erzeugen", "Gerar partida", "Genera partita", "Wedstrijd genereren", "إنشاء مباراة", "मैच बनाएँ", "試合を生成", "生成比赛", "Tengeneza mechi"],
  "Open match": ["Abrir partido", "Ouvrir le match", "Spiel öffnen", "Abrir partida", "Apri partita", "Wedstrijd openen", "فتح المباراة", "मैच खोलें", "試合を開く", "打开比赛", "Fungua mechi"],
  "Strength as of": ["Fuerza a fecha de", "Force à la date du", "Stärke zum Stichtag", "Força na data de", "Forza alla data", "Sterkte per", "القوة حتى تاريخ", "इस तारीख तक की ताकत", "基準日の戦力", "实力截至", "Nguvu hadi tarehe"],

  // Penalties
  "Penalties": ["Penaltis", "Penalties", "Elfmeter", "Pênaltis", "Rigori", "Strafschoppen", "ركلات الجزاء", "पेनल्टी", "PK", "点球", "Penalti"],
  "Pen": ["Pen.", "Pen.", "Elfm.", "Pên.", "Rig.", "Pen.", "جزاء", "पेनल्टी", "PK", "点球", "Penalti"],
  "Pen goals": ["Goles de penalti", "Buts sur penalty", "Elfmetertore", "Gols de pênalti", "Gol su rigore", "Strafschopdoelpunten", "أهداف من ركلات الجزاء", "पेनल्टी गोल", "PKゴール", "点球进球", "Mabao ya penalti"],
  "Penalty goals": ["Goles de penalti", "Buts sur penalty", "Elfmetertore", "Gols de pênalti", "Gol su rigore", "Strafschopdoelpunten", "أهداف من ركلات الجزاء", "पेनल्टी गोल", "PKゴール", "点球进球", "Mabao ya penalti"],
  "Penalty takers": ["Lanzadores de penaltis", "Tireurs de penalty", "Elfmeterschützen", "Cobradores de pênalti", "Rigoristi", "Strafschopnemers", "منفذو ركلات الجزاء", "पेनल्टी लेने वाले", "PKキッカー", "点球手", "Wapigaji penalti"],
  "Penalty dives (MODEL)": ["Estiradas en penaltis (MODELO)", "Plongeons sur penalty (MODÈLE)", "Sprungseite bei Elfmetern (MODELL)", "Saltos em pênaltis (MODELO)", "Tuffi sui rigori (MODELLO)", "Duiken bij strafschoppen (MODEL)", "ارتماءات الحارس في ركلات الجزاء (نموذج)", "पेनल्टी पर डाइव (मॉडल)", "PKでのダイブ方向（モデル）", "点球扑救方向（模型）", "Kuruka kwenye penalti (MODELI)"],
  "Goalkeeper dive tendency": ["Hacia dónde se lanza el portero", "Côté de plongeon du gardien", "Sprungseite des Torwarts", "Lado do mergulho do goleiro", "Lato del tuffo del portiere", "Duikrichting van de keeper", "اتجاه ارتماء الحارس", "गोलकीपर की डाइव की दिशा", "GKのダイブ傾向", "门将扑救倾向", "Mwelekeo wa kuruka kwa kipa"],
  "Taker's left": ["Izquierda del lanzador", "Gauche du tireur", "Links vom Schützen", "Esquerda do cobrador", "Sinistra del rigorista", "Links van de nemer", "يسار المسدد", "किकर का बायाँ", "キッカーから見て左", "主罚者左侧", "Kushoto kwa mpigaji"],
  "Taker's right": ["Derecha del lanzador", "Droite du tireur", "Rechts vom Schützen", "Direita do cobrador", "Destra del rigorista", "Rechts van de nemer", "يمين المسدد", "किकर का दायाँ", "キッカーから見て右", "主罚者右侧", "Kulia kwa mpigaji"],
  "Keeper's best guess": ["La mejor apuesta del portero", "Le meilleur pari du gardien", "Beste Wahl des Torwarts", "O melhor palpite do goleiro", "La scelta migliore del portiere", "Beste gok van de keeper", "أفضل تخمين للحارس", "गोलकीपर का सबसे अच्छा अनुमान", "GKの最善の読み", "门将的最佳判断", "Kisio bora la kipa"],

  // Players and squads
  "Bench": ["Suplentes", "Remplaçants", "Ersatzbank", "Banco", "Panchina", "Bank", "البدلاء", "बेंच", "控え", "替补席", "Benchi"],
  "Substituted": ["Sustituido", "Remplacé", "Ausgewechselt", "Substituído", "Sostituito", "Gewisseld", "تم استبداله", "बदले गए", "交代", "被换下", "Amebadilishwa"],
  "Squad status": ["Estado de la plantilla", "État de l'effectif", "Kaderstatus", "Situação do elenco", "Stato della rosa", "Selectiestatus", "حالة الفريق", "दल की स्थिति", "スカッド状況", "阵容状态", "Hali ya kikosi"],
  "Managing": ["Diriges a", "Équipe dirigée", "Betreutes Team", "Treinando", "Squadra guidata", "Coach van", "الفريق المُدار", "प्रबंधित टीम", "指揮チーム", "执教球队", "Unaongoza"],
  "Danger men": ["Hombres peligrosos", "Joueurs dangereux", "Gefährlichste Spieler", "Jogadores perigosos", "Uomini pericolosi", "Gevaarlijke spelers", "أخطر اللاعبين", "ख़तरनाक खिलाड़ी", "要注意選手", "危险人物", "Wachezaji hatari"],
  "Key battle": ["Duelo clave", "Duel clé", "Schlüsselduell", "Duelo-chave", "Duello chiave", "Sleutelduel", "المواجهة الحاسمة", "अहम मुकाबला", "注目の対決", "关键对位", "Pambano muhimu"],
  "Leaders": ["Líderes", "Leaders", "Bestwerte", "Líderes", "Leader", "Koplopers", "المتصدرون", "अग्रणी", "トップ選手", "领先者", "Viongozi"],
  "Favourite side": ["Banda preferida", "Côté préféré", "Bevorzugte Seite", "Lado preferido", "Fascia preferita", "Voorkeurskant", "الجهة المفضلة", "पसंदीदा फ़्लैंक", "得意サイド", "惯用边路", "Upande pendwa"],
  "Modelled favourite side": ["Banda preferida (modelo)", "Côté préféré (modèle)", "Bevorzugte Seite (Modell)", "Lado preferido (modelo)", "Fascia preferita (modello)", "Voorkeurskant (model)", "الجهة المفضلة (نموذج)", "पसंदीदा फ़्लैंक (मॉडल)", "得意サイド（モデル）", "惯用边路（模型）", "Upande pendwa (modeli)"],
  "Compared with peers": ["Comparado con jugadores similares", "Comparé à ses pairs", "Im Vergleich zu Positionskollegen", "Comparado com os pares", "Rispetto ai pari ruolo", "Vergeleken met vergelijkbare spelers", "مقارنة بنظرائه", "समकक्षों से तुलना", "同ポジションとの比較", "与同位置球员比较", "Ukilinganisha na wenzake"],
  "Competitive int'l goals": ["Goles internacionales oficiales", "Buts internationaux officiels", "Länderspieltore (Pflichtspiele)", "Gols internacionais oficiais", "Gol internazionali ufficiali", "Interlanddoelpunten (officieel)", "أهداف دولية رسمية", "प्रतिस्पर्धी अंतरराष्ट्रीय गोल", "公式国際試合のゴール", "正式国际比赛进球", "Mabao ya kimataifa ya mashindano"],
  "Fresh": ["Fresco", "Frais", "Frisch", "Descansado", "Fresco", "Fris", "منتعش", "तरोताज़ा", "フレッシュ", "体能充沛", "Mwenye nguvu"],
  "Struggling": ["Con problemas", "En difficulté", "Angeschlagen", "Em dificuldade", "In difficoltà", "Heeft het zwaar", "يعاني", "संघर्ष कर रहा", "苦戦中", "吃力", "Anahangaika"],

  // Pressing and passing
  "Pressures": ["Presiones", "Pressions", "Pressingaktionen", "Pressões", "Pressioni", "Drukmomenten", "الضغط", "दबाव", "プレス", "施压", "Shinikizo"],
  "Most pressures": ["Más presiones", "Plus de pressions", "Meiste Pressingaktionen", "Mais pressões", "Più pressioni", "Meeste drukmomenten", "الأكثر ضغطاً", "सबसे ज़्यादा दबाव", "プレス数最多", "施压最多", "Shinikizo nyingi zaidi"],
  "Press switch": ["Cambio de presión", "Changement de pressing", "Pressing-Wechsel", "Mudança de pressão", "Cambio di pressing", "Pressingwissel", "تحول في الضغط", "प्रेसिंग में बदलाव", "プレス切り替え", "逼抢变化", "Mabadiliko ya kubana"],
  "Pass completion": ["Precisión de pase", "Passes réussies", "Passquote", "Precisão de passe", "Precisione passaggi", "Passnauwkeurigheid", "دقة التمرير", "पास सफलता", "パス成功率", "传球成功率", "Usahihi wa pasi"],
  "Field tilt": ["Dominio territorial", "Domination territoriale", "Feldüberlegenheit", "Domínio territorial", "Predominio territoriale", "Terreinoverwicht", "السيطرة الميدانية", "मैदानी दबदबा", "フィールドティルト", "场地倾斜度", "Utawala wa uwanja"],
  "Line height": ["Altura de la línea", "Hauteur de la ligne", "Linienhöhe", "Altura da linha", "Altezza della linea", "Hoogte van de linie", "ارتفاع خط الدفاع", "लाइन की ऊँचाई", "ラインの高さ", "防线高度", "Urefu wa mstari"],
  "Chaos spell": ["Racha de caos", "Séquence de chaos", "Chaosphase", "Período de caos", "Fase di caos", "Chaosfase", "فترة فوضى", "अराजकता का दौर", "混戦の時間帯", "混乱阶段", "Kipindi cha vurugu"],

  // Difficulty
  "Easy": ["Fácil", "Facile", "Leicht", "Fácil", "Facile", "Makkelijk", "سهل", "आसान", "易しい", "容易", "Rahisi"],
  "Medium": ["Media", "Moyenne", "Mittel", "Média", "Media", "Gemiddeld", "متوسط", "मध्यम", "普通", "中等", "Wastani"],
  "Hard": ["Difícil", "Difficile", "Schwer", "Difícil", "Difficile", "Moeilijk", "صعب", "कठिन", "難しい", "困难", "Ngumu"],

  // Controls and the truth loop
  "Play": ["Reproducir", "Lecture", "Abspielen", "Reproduzir", "Riproduci", "Afspelen", "تشغيل", "चलाएँ", "再生", "播放", "Cheza"],
  "Pause": ["Pausa", "Pause", "Pause", "Pausar", "Pausa", "Pauzeren", "إيقاف مؤقت", "रोकें", "一時停止", "暂停", "Sitisha"],
  "Resume": ["Reanudar", "Reprendre", "Fortsetzen", "Retomar", "Riprendi", "Hervatten", "استئناف", "फिर शुरू करें", "再開", "继续", "Endelea"],
  "Restart": ["Reiniciar", "Recommencer", "Neu starten", "Reiniciar", "Ricomincia", "Opnieuw", "إعادة التشغيل", "फिर से शुरू", "最初から", "重新开始", "Anza upya"],
  "Edit": ["Editar", "Modifier", "Bearbeiten", "Editar", "Modifica", "Bewerken", "تحرير", "संपादित करें", "編集", "编辑", "Hariri"],
  "Put on air": ["Emitir", "Mettre à l'antenne", "Auf Sendung schicken", "Colocar no ar", "Manda in onda", "Uitzenden", "بث على الهواء", "प्रसारित करें", "放送する", "上屏播出", "Rusha hewani"],
  "Brief me": ["Infórmame", "Briefez-moi", "Lagebericht", "Resuma para mim", "Aggiornami", "Briefing", "أطلعني", "मुझे ब्रीफ़ करें", "ブリーフィング", "给我简报", "Nipe muhtasari"],
  "Commentator whisper": ["Apuntes para el narrador", "Notes du commentateur", "Kommentatoren-Notizen", "Notas para o narrador", "Note per il telecronista", "Notities voor de commentator", "ملاحظات للمعلّق", "कमेंटेटर के लिए नोट्स", "実況メモ", "解说提示", "Vidokezo vya mtangazaji"],
  "Recall": ["Detección", "Détection", "Trefferquote", "Detecção", "Rilevamento", "Detectie", "نسبة الاكتشاف", "पहचान दर", "検出率", "检出率", "Ugunduzi"],
  "Verifier drill": ["Simulacro del verificador", "Exercice du vérificateur", "Verifier-Test", "Teste do verificador", "Esercitazione del verificatore", "Verifier-oefening", "اختبار المدقق", "वेरिफ़ायर अभ्यास", "検証ドリル", "核查演练", "Zoezi la mhakiki"],
  "Peak": ["Máximo", "Pic", "Höchstwert", "Pico", "Picco", "Piek", "الذروة", "शिखर", "ピーク", "峰值", "Kilele"],
  "Overall": ["General", "Global", "Gesamt", "Geral", "Complessivo", "Totaal", "إجمالي", "कुल", "全体", "总体", "Jumla"],
  "Hover to inspect": ["Pasa el cursor para ver", "Survolez pour inspecter", "Zum Ansehen darüberfahren", "Passe o cursor para ver", "Passa il mouse per vedere", "Beweeg erover om te bekijken", "مرّر للمعاينة", "देखने के लिए होवर करें", "ホバーで詳細", "悬停查看", "Elekeza kipanya kukagua"],
};

export const GLOSSARY: Record<string, Record<string, string>> = Object.fromEntries(
  LANGS.map((lang, i) => [lang, Object.fromEntries(Object.entries(TERMS).map(([en, row]) => [en, row[i]]))]),
);

/** The glossary entry for `term` in `language`, also when the page writes it in lower case. */
export function glossary(language: string, term: string): string | undefined {
  const table = GLOSSARY[language];
  if (!table) return undefined;
  return table[term] ?? table[term.charAt(0).toUpperCase() + term.slice(1)];
}
