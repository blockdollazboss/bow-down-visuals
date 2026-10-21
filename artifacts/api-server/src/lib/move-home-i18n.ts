/**
 * Move Home copy, per locale (server side).
 *
 * Two kinds of server-composed text live here:
 *   - the step titles + blurbs, which are never stored — they render
 *     per request in getMoveHomeStatus, in the caller's locale;
 *   - the drafting templates buildDrafts composes a creator's first
 *     drafts from (bio, starter product, press-kit tagline, welcome
 *     email, launch captions). A drafting pass composes in the locale
 *     of the request that ran it; the composed drafts are then the
 *     creator's own stored data — editable, and never re-translated
 *     or rewritten by a later read in another language.
 *
 * What is NOT here: anything the creator typed (display name, genre,
 * location, their track titles, their own bio seed / tagline /
 * starter-product title) — that is user data, interpolated through
 * {placeholders} and never translated. The launch-post hashtags
 * (#MovedHome #IndependentCreator) are functional tags, not prose;
 * they stay identical in every locale and live in lib/move-home.
 * MoveHomeError messages stay English, like every other route's
 * error strings.
 *
 * Placeholders: {displayName} {genre} {laneNoun} {location}
 * {platforms} {title} {homePath}. The {genre} value is pre-composed
 * by the caller as "<genre> " or "" (the shipped English behaviour),
 * and {location} in bioIntro receives the filled bioLocationClause
 * or "". The catalog tests pin the placeholder multiset per string
 * across all ten locales.
 */
import type { MoveHomeStepKey } from "@workspace/db";
import type { ServerLocale } from "./server-i18n";

export interface MoveHomeStepCopy {
  title: string;
  blurb: string;
}

export interface MoveHomeCopy {
  steps: Record<MoveHomeStepKey, MoveHomeStepCopy>;
  /** Fallback display name when the creator has given us nothing. */
  defaultCreatorName: string;
  /** Lane noun per vertical key (music → "artist", …). */
  laneNouns: Record<string, string>;
  bioIntro: string;
  bioLocationClause: string;
  bioKnownFrom: string;
  bioEverythingHere: string;
  productDescription: string;
  starterProductTitle: string;
  starterProductDescription: string;
  taglineGenre: string;
  taglinePlain: string;
  listName: string;
  listDescription: string;
  welcomeSubject: string;
  welcomeBody: string;
  announcementMusic: string;
  announcementOther: string;
  tiktokCaption: string;
  /** Label for a connected Facebook account with no page name. */
  facebookPageLabel: string;
}

export const MOVE_HOME_COPY: Record<ServerLocale, MoveHomeCopy> = {
  en: {
    steps: {
      profile: {
        title: "Your Grand Stage profile",
        blurb:
          "Your home page — name, bio, lane, and the social links from the accounts you've actually connected.",
      },
      store: {
        title: "Your starter store",
        blurb:
          "Your first products, drafted from your own catalog — live in your store the moment you approve them.",
      },
      press_kit: {
        title: "Your press kit",
        blurb:
          "A shareable EPK — bio, top tracks, and your connected socials — drafted from your profile.",
      },
      email_list: {
        title: "Your email list + welcome",
        blurb:
          "The audience you own. A fan list with a welcome email, ready before your first fan lands.",
      },
      launch_posts: {
        title: "Your launch posts",
        blurb:
          "Announcement drafts for each connected social, saved to your Post Scheduler as drafts — you pick when they fire.",
      },
    },
    defaultCreatorName: "New Creator",
    laneNouns: {
      music: "artist",
      video: "video creator",
      gaming: "streamer",
      podcast: "podcaster",
      film: "filmmaker",
      tv: "show creator",
      influencer: "creator",
      education: "educator",
      other: "creator",
    },
    bioIntro: "{displayName} is a {genre}{laneNoun} building a home for everything they make{location}.",
    bioLocationClause: " — based in {location}",
    bioKnownFrom: "You may know the work from {platforms} — now it all lives in one place.",
    bioEverythingHere:
      "Everything lives here now — music, videos, store, and memberships, straight from the source.",
    productDescription: "Official download of \"{title}\" by {displayName} — yours from the source.",
    starterProductTitle: "{displayName} — Supporter Pack",
    starterProductDescription:
      "Starter product — edit this description to say exactly what buyers get before you approve it. Nothing goes on sale until you say so.",
    taglineGenre: "{genre}{laneNoun} — official press kit",
    taglinePlain: "{displayName} — official press kit",
    listName: "{displayName} — Inner Circle",
    listDescription:
      "First to hear new drops, shows, and exclusives from {displayName}. No noise — just the good stuff.",
    welcomeSubject: "You're in — welcome to {displayName}'s inner circle",
    welcomeBody:
      "Welcome home.\n\nYou just joined the list that hears everything first — new {genre}drops, videos, shows, and store exclusives from {displayName}, before anywhere else.\n\nStart here: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "I moved home. 🏠 Everything I make — music, videos, store, memberships — now lives in one place I own: bowdownvisuals.com{homePath}. No algorithm between us. Come see the new home.",
    announcementOther:
      "I moved home. 🏠 Everything I make — videos, work, store, memberships — now lives in one place I own: bowdownvisuals.com{homePath}. No algorithm between us. Come see the new home.",
    tiktokCaption:
      "I moved home 🏠 Everything I make now lives in one place I own — link in bio. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Facebook Page",
  },
  es: {
    steps: {
      profile: {
        title: "Tu perfil Grand Stage",
        blurb:
          "Tu página de inicio: nombre, biografía, especialidad y los enlaces sociales de las cuentas que sí has conectado.",
      },
      store: {
        title: "Tu tienda inicial",
        blurb:
          "Tus primeros productos, redactados desde tu propio catálogo: en vivo en tu tienda en cuanto los apruebes.",
      },
      press_kit: {
        title: "Tu kit de prensa",
        blurb:
          "Un EPK para compartir — biografía, temas destacados y tus redes conectadas — redactado desde tu perfil.",
      },
      email_list: {
        title: "Tu lista de correo + bienvenida",
        blurb:
          "La audiencia que es tuya. Una lista de fans con un correo de bienvenida, lista antes de que llegue tu primer fan.",
      },
      launch_posts: {
        title: "Tus publicaciones de lanzamiento",
        blurb:
          "Borradores de anuncio para cada red conectada, guardados en tu Programador de publicaciones como borradores: tú eliges cuándo se publican.",
      },
    },
    defaultCreatorName: "Nuevo creador",
    laneNouns: {
      music: "artista",
      video: "creador de videos",
      gaming: "streamer",
      podcast: "podcaster",
      film: "cineasta",
      tv: "creador de programas",
      influencer: "creador",
      education: "educador",
      other: "creador",
    },
    bioIntro: "{displayName} es un {genre}{laneNoun} que está construyendo un hogar para todo lo que crea{location}.",
    bioLocationClause: " — con base en {location}",
    bioKnownFrom: "Quizá conoces su trabajo por {platforms}: ahora todo vive en un solo lugar.",
    bioEverythingHere:
      "Ahora todo vive aquí: música, videos, tienda y membresías, directo de la fuente.",
    productDescription: "Descarga oficial de \"{title}\" de {displayName}: tuya, directo de la fuente.",
    starterProductTitle: "{displayName} — Pack de apoyo",
    starterProductDescription:
      "Producto inicial: edita esta descripción para decir exactamente qué reciben los compradores antes de aprobarla. Nada sale a la venta hasta que tú lo digas.",
    taglineGenre: "{genre}{laneNoun} — kit de prensa oficial",
    taglinePlain: "{displayName} — kit de prensa oficial",
    listName: "{displayName} — Círculo interno",
    listDescription:
      "Los primeros en enterarse de lanzamientos, shows y exclusivas de {displayName}. Sin ruido: solo lo bueno.",
    welcomeSubject: "Ya estás dentro: bienvenido al círculo interno de {displayName}",
    welcomeBody:
      "Bienvenido a casa.\n\nAcabas de unirte a la lista que se entera de todo primero: nuevos lanzamientos de {genre}música, videos, shows y exclusivas de la tienda de {displayName}, antes que en cualquier otro lugar.\n\nEmpieza aquí: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "Me mudé de casa. 🏠 Todo lo que hago — música, videos, tienda, membresías — ahora vive en un solo lugar que es mío: bowdownvisuals.com{homePath}. Sin algoritmos entre nosotros. Ven a ver la nueva casa.",
    announcementOther:
      "Me mudé de casa. 🏠 Todo lo que hago — videos, trabajo, tienda, membresías — ahora vive en un solo lugar que es mío: bowdownvisuals.com{homePath}. Sin algoritmos entre nosotros. Ven a ver la nueva casa.",
    tiktokCaption:
      "Me mudé de casa 🏠 Todo lo que hago ahora vive en un solo lugar que es mío: enlace en la bio. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Página de Facebook",
  },
  fr: {
    steps: {
      profile: {
        title: "Votre profil Grand Stage",
        blurb:
          "Votre page d'accueil — nom, bio, domaine et les liens sociaux des comptes que vous avez réellement connectés.",
      },
      store: {
        title: "Votre boutique de départ",
        blurb:
          "Vos premiers produits, rédigés depuis votre propre catalogue — en ligne dans votre boutique dès que vous les approuvez.",
      },
      press_kit: {
        title: "Votre dossier de presse",
        blurb:
          "Un EPK à partager — bio, titres phares et vos réseaux connectés — rédigé depuis votre profil.",
      },
      email_list: {
        title: "Votre liste e-mail + bienvenue",
        blurb:
          "L'audience qui vous appartient. Une liste de fans avec un e-mail de bienvenue, prête avant l'arrivée de votre premier fan.",
      },
      launch_posts: {
        title: "Vos publications de lancement",
        blurb:
          "Des brouillons d'annonce pour chaque réseau connecté, enregistrés dans votre Planificateur de publications — vous choisissez quand ils partent.",
      },
    },
    defaultCreatorName: "Nouveau créateur",
    laneNouns: {
      music: "artiste",
      video: "créateur de vidéos",
      gaming: "streamer",
      podcast: "podcasteur",
      film: "cinéaste",
      tv: "créateur d'émissions",
      influencer: "créateur",
      education: "éducateur",
      other: "créateur",
    },
    bioIntro: "{displayName} est un {genre}{laneNoun} qui construit un chez-soi pour tout ce qu'il crée{location}.",
    bioLocationClause: " — basé à {location}",
    bioKnownFrom: "Vous connaissez peut-être son travail via {platforms} — désormais, tout vit au même endroit.",
    bioEverythingHere:
      "Tout vit ici désormais — musique, vidéos, boutique et abonnements, directement à la source.",
    productDescription: "Téléchargement officiel de « {title} » par {displayName} — à vous, directement à la source.",
    starterProductTitle: "{displayName} — Pack soutien",
    starterProductDescription:
      "Produit de départ — modifiez cette description pour dire exactement ce que les acheteurs reçoivent avant de l'approuver. Rien n'est mis en vente sans votre accord.",
    taglineGenre: "{genre}{laneNoun} — dossier de presse officiel",
    taglinePlain: "{displayName} — dossier de presse officiel",
    listName: "{displayName} — Cercle privé",
    listDescription:
      "Les premiers informés des nouveautés, concerts et exclusivités de {displayName}. Zéro bruit — que le meilleur.",
    welcomeSubject: "Vous y êtes — bienvenue dans le cercle privé de {displayName}",
    welcomeBody:
      "Bienvenue chez vous.\n\nVous venez de rejoindre la liste qui apprend tout en premier — nouvelles sorties {genre}musique, vidéos, concerts et exclusivités de la boutique de {displayName}, avant partout ailleurs.\n\nCommencez ici : bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "J'ai déménagé. 🏠 Tout ce que je fais — musique, vidéos, boutique, abonnements — vit désormais dans un seul endroit qui m'appartient : bowdownvisuals.com{homePath}. Aucun algorithme entre nous. Venez voir la nouvelle maison.",
    announcementOther:
      "J'ai déménagé. 🏠 Tout ce que je fais — vidéos, travail, boutique, abonnements — vit désormais dans un seul endroit qui m'appartient : bowdownvisuals.com{homePath}. Aucun algorithme entre nous. Venez voir la nouvelle maison.",
    tiktokCaption:
      "J'ai déménagé 🏠 Tout ce que je fais vit désormais dans un seul endroit qui m'appartient — lien en bio. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Page Facebook",
  },
  pt: {
    steps: {
      profile: {
        title: "Seu perfil Grand Stage",
        blurb:
          "Sua página inicial — nome, bio, área e os links sociais das contas que você realmente conectou.",
      },
      store: {
        title: "Sua loja inicial",
        blurb:
          "Seus primeiros produtos, rascunhados a partir do seu próprio catálogo — no ar na sua loja assim que você aprovar.",
      },
      press_kit: {
        title: "Seu kit de imprensa",
        blurb:
          "Um EPK compartilhável — bio, faixas em destaque e suas redes conectadas — rascunhado a partir do seu perfil.",
      },
      email_list: {
        title: "Sua lista de e-mail + boas-vindas",
        blurb:
          "O público que é seu. Uma lista de fãs com um e-mail de boas-vindas, pronta antes do primeiro fã chegar.",
      },
      launch_posts: {
        title: "Suas postagens de lançamento",
        blurb:
          "Rascunhos de anúncio para cada rede conectada, salvos no seu Agendador de postagens como rascunhos — você escolhe quando eles saem.",
      },
    },
    defaultCreatorName: "Novo criador",
    laneNouns: {
      music: "artista",
      video: "criador de vídeos",
      gaming: "streamer",
      podcast: "podcaster",
      film: "cineasta",
      tv: "criador de programas",
      influencer: "criador",
      education: "educador",
      other: "criador",
    },
    bioIntro: "{displayName} é um {genre}{laneNoun} construindo um lar para tudo o que cria{location}.",
    bioLocationClause: " — baseado em {location}",
    bioKnownFrom: "Você talvez conheça o trabalho por {platforms} — agora tudo vive em um só lugar.",
    bioEverythingHere:
      "Agora tudo vive aqui — música, vídeos, loja e assinaturas, direto da fonte.",
    productDescription: "Download oficial de \"{title}\" de {displayName} — seu, direto da fonte.",
    starterProductTitle: "{displayName} — Pacote Apoiador",
    starterProductDescription:
      "Produto inicial — edite esta descrição para dizer exatamente o que os compradores recebem antes de aprovar. Nada entra em venda até você dizer.",
    taglineGenre: "{genre}{laneNoun} — kit de imprensa oficial",
    taglinePlain: "{displayName} — kit de imprensa oficial",
    listName: "{displayName} — Círculo Interno",
    listDescription:
      "Os primeiros a saber de lançamentos, shows e exclusividades de {displayName}. Sem ruído — só o que importa.",
    welcomeSubject: "Você entrou — boas-vindas ao círculo interno de {displayName}",
    welcomeBody:
      "Bem-vindo à sua casa.\n\nVocê acabou de entrar na lista que fica sabendo de tudo primeiro — novos lançamentos de {genre}música, vídeos, shows e exclusividades da loja de {displayName}, antes de qualquer outro lugar.\n\nComece aqui: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "Mudei de casa. 🏠 Tudo o que eu faço — música, vídeos, loja, assinaturas — agora vive em um só lugar que é meu: bowdownvisuals.com{homePath}. Nenhum algoritmo entre nós. Venha ver a nova casa.",
    announcementOther:
      "Mudei de casa. 🏠 Tudo o que eu faço — vídeos, trabalho, loja, assinaturas — agora vive em um só lugar que é meu: bowdownvisuals.com{homePath}. Nenhum algoritmo entre nós. Venha ver a nova casa.",
    tiktokCaption:
      "Mudei de casa 🏠 Tudo o que eu faço agora vive em um só lugar que é meu — link na bio. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Página do Facebook",
  },
  de: {
    steps: {
      profile: {
        title: "Dein Grand-Stage-Profil",
        blurb:
          "Deine Startseite — Name, Bio, Bereich und die Social-Links der Konten, die du wirklich verbunden hast.",
      },
      store: {
        title: "Dein Starter-Shop",
        blurb:
          "Deine ersten Produkte, entworfen aus deinem eigenen Katalog — live in deinem Shop, sobald du sie freigibst.",
      },
      press_kit: {
        title: "Dein Presse-Kit",
        blurb:
          "Ein EPK zum Teilen — Bio, Top-Tracks und deine verbundenen Socials — entworfen aus deinem Profil.",
      },
      email_list: {
        title: "Deine E-Mail-Liste + Willkommen",
        blurb:
          "Das Publikum, das dir gehört. Eine Fan-Liste mit Willkommens-E-Mail, bereit, bevor dein erster Fan landet.",
      },
      launch_posts: {
        title: "Deine Launch-Posts",
        blurb:
          "Ankündigungs-Entwürfe für jedes verbundene Netzwerk, als Entwürfe in deinem Post-Planer gespeichert — du entscheidest, wann sie rausgehen.",
      },
    },
    defaultCreatorName: "Neuer Creator",
    laneNouns: {
      music: "Künstler",
      video: "Video-Creator",
      gaming: "Streamer",
      podcast: "Podcaster",
      film: "Filmemacher",
      tv: "Show-Creator",
      influencer: "Creator",
      education: "Bildungs-Creator",
      other: "Creator",
    },
    bioIntro: "{displayName} ist ein {genre}{laneNoun}, der ein Zuhause für alles baut, was er macht{location}.",
    bioLocationClause: " — ansässig in {location}",
    bioKnownFrom: "Du kennst die Arbeit vielleicht von {platforms} — jetzt lebt alles an einem Ort.",
    bioEverythingHere:
      "Alles lebt jetzt hier — Musik, Videos, Shop und Mitgliedschaften, direkt von der Quelle.",
    productDescription: "Offizieller Download von „{title}\" von {displayName} — deiner, direkt von der Quelle.",
    starterProductTitle: "{displayName} — Supporter-Paket",
    starterProductDescription:
      "Starter-Produkt — bearbeite diese Beschreibung vor der Freigabe so, dass sie genau sagt, was Käufer bekommen. Nichts geht in den Verkauf, bevor du es sagst.",
    taglineGenre: "{genre}{laneNoun} — offizielles Presse-Kit",
    taglinePlain: "{displayName} — offizielles Presse-Kit",
    listName: "{displayName} — Innerer Kreis",
    listDescription:
      "Die Ersten, die von neuen Drops, Shows und Exklusivem von {displayName} hören. Kein Rauschen — nur das Gute.",
    welcomeSubject: "Du bist drin — willkommen in {displayName}s innerem Kreis",
    welcomeBody:
      "Willkommen zu Hause.\n\nDu bist gerade der Liste beigetreten, die alles zuerst hört — neue {genre}Musik-Drops, Videos, Shows und Shop-Exklusives von {displayName}, vor allen anderen Orten.\n\nStarte hier: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "Ich bin umgezogen. 🏠 Alles, was ich mache — Musik, Videos, Shop, Mitgliedschaften — lebt jetzt an einem Ort, der mir gehört: bowdownvisuals.com{homePath}. Kein Algorithmus zwischen uns. Komm und sieh dir das neue Zuhause an.",
    announcementOther:
      "Ich bin umgezogen. 🏠 Alles, was ich mache — Videos, Arbeit, Shop, Mitgliedschaften — lebt jetzt an einem Ort, der mir gehört: bowdownvisuals.com{homePath}. Kein Algorithmus zwischen uns. Komm und sieh dir das neue Zuhause an.",
    tiktokCaption:
      "Ich bin umgezogen 🏠 Alles, was ich mache, lebt jetzt an einem Ort, der mir gehört — Link in der Bio. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Facebook-Seite",
  },
  it: {
    steps: {
      profile: {
        title: "Il tuo profilo Grand Stage",
        blurb:
          "La tua pagina principale — nome, bio, settore e i link social degli account che hai davvero collegato.",
      },
      store: {
        title: "Il tuo negozio iniziale",
        blurb:
          "I tuoi primi prodotti, abbozzati dal tuo stesso catalogo — attivi nel tuo negozio appena li approvi.",
      },
      press_kit: {
        title: "Il tuo press kit",
        blurb:
          "Un EPK condivisibile — bio, brani di punta e i tuoi social collegati — abbozzato dal tuo profilo.",
      },
      email_list: {
        title: "La tua lista e-mail + benvenuto",
        blurb:
          "Il pubblico che ti appartiene. Una lista di fan con un'e-mail di benvenuto, pronta prima che arrivi il primo fan.",
      },
      launch_posts: {
        title: "I tuoi post di lancio",
        blurb:
          "Bozze di annuncio per ogni social collegato, salvate nel tuo Pianificatore post come bozze — scegli tu quando farle partire.",
      },
    },
    defaultCreatorName: "Nuovo creator",
    laneNouns: {
      music: "artista",
      video: "creatore di video",
      gaming: "streamer",
      podcast: "podcaster",
      film: "regista",
      tv: "creatore di programmi",
      influencer: "creator",
      education: "educatore",
      other: "creator",
    },
    bioIntro: "{displayName} è un {genre}{laneNoun} che sta costruendo una casa per tutto ciò che crea{location}.",
    bioLocationClause: " — con base a {location}",
    bioKnownFrom: "Forse conosci il suo lavoro da {platforms} — ora tutto vive in un unico posto.",
    bioEverythingHere:
      "Ora tutto vive qui — musica, video, negozio e abbonamenti, direttamente dalla fonte.",
    productDescription: "Download ufficiale di \"{title}\" di {displayName} — tuo, direttamente dalla fonte.",
    starterProductTitle: "{displayName} — Pacchetto Sostenitore",
    starterProductDescription:
      "Prodotto iniziale — modifica questa descrizione per dire esattamente cosa ricevono gli acquirenti prima di approvarla. Niente va in vendita finché non lo dici tu.",
    taglineGenre: "{genre}{laneNoun} — press kit ufficiale",
    taglinePlain: "{displayName} — press kit ufficiale",
    listName: "{displayName} — Cerchia ristretta",
    listDescription:
      "I primi a sapere di nuove uscite, concerti ed esclusive di {displayName}. Niente rumore — solo il meglio.",
    welcomeSubject: "Sei dentro — benvenuto nella cerchia ristretta di {displayName}",
    welcomeBody:
      "Benvenuto a casa.\n\nSei appena entrato nella lista che sa tutto per prima — nuove uscite di {genre}musica, video, concerti ed esclusive del negozio di {displayName}, prima che altrove.\n\nInizia qui: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "Ho cambiato casa. 🏠 Tutto ciò che faccio — musica, video, negozio, abbonamenti — ora vive in un unico posto che è mio: bowdownvisuals.com{homePath}. Nessun algoritmo tra noi. Vieni a vedere la nuova casa.",
    announcementOther:
      "Ho cambiato casa. 🏠 Tutto ciò che faccio — video, lavoro, negozio, abbonamenti — ora vive in un unico posto che è mio: bowdownvisuals.com{homePath}. Nessun algoritmo tra noi. Vieni a vedere la nuova casa.",
    tiktokCaption:
      "Ho cambiato casa 🏠 Tutto ciò che faccio ora vive in un unico posto che è mio — link in bio. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Pagina Facebook",
  },
  hi: {
    steps: {
      profile: {
        title: "आपकी Grand Stage प्रोफ़ाइल",
        blurb:
          "आपका होम पेज — नाम, बायो, क्षेत्र, और उन अकाउंट्स के सोशल लिंक जिन्हें आपने सच में कनेक्ट किया है।",
      },
      store: {
        title: "आपका स्टार्टर स्टोर",
        blurb:
          "आपके पहले उत्पाद, आपके अपने कैटलॉग से तैयार — जैसे ही आप मंज़ूरी देंगे, आपके स्टोर में लाइव।",
      },
      press_kit: {
        title: "आपकी प्रेस किट",
        blurb:
          "एक शेयर करने योग्य EPK — बायो, शीर्ष ट्रैक, और आपके कनेक्टेड सोशल — आपकी प्रोफ़ाइल से तैयार।",
      },
      email_list: {
        title: "आपकी ईमेल सूची + स्वागत",
        blurb:
          "वह दर्शक जो आपके हैं। एक फ़ैन सूची, स्वागत ईमेल के साथ — आपके पहले फ़ैन के आने से पहले तैयार।",
      },
      launch_posts: {
        title: "आपकी लॉन्च पोस्ट",
        blurb:
          "हर कनेक्टेड सोशल के लिए घोषणा ड्राफ़्ट, आपके Post Scheduler में ड्राफ़्ट के रूप में सहेजे गए — कब जाएं, यह आप तय करते हैं।",
      },
    },
    defaultCreatorName: "नया क्रिएटर",
    laneNouns: {
      music: "कलाकार",
      video: "वीडियो क्रिएटर",
      gaming: "स्ट्रीमर",
      podcast: "पॉडकास्टर",
      film: "फ़िल्म निर्माता",
      tv: "शो निर्माता",
      influencer: "क्रिएटर",
      education: "शिक्षक",
      other: "क्रिएटर",
    },
    bioIntro: "{displayName} एक {genre}{laneNoun} हैं, जो अपनी हर रचना के लिए एक घर बना रहे हैं{location}।",
    bioLocationClause: " — {location} में स्थित",
    bioKnownFrom: "आप उनका काम {platforms} से जानते होंगे — अब सब कुछ एक ही जगह रहता है।",
    bioEverythingHere: "अब सब कुछ यहीं रहता है — संगीत, वीडियो, स्टोर और सदस्यताएँ, सीधे स्रोत से।",
    productDescription: "{displayName} के \"{title}\" का आधिकारिक डाउनलोड — आपका, सीधे स्रोत से।",
    starterProductTitle: "{displayName} — सपोर्टर पैक",
    starterProductDescription:
      "शुरुआती उत्पाद — मंज़ूरी देने से पहले इस विवरण को संपादित करके ठीक-ठीक बताएं कि खरीदारों को क्या मिलेगा। जब तक आप न कहें, कुछ भी बिक्री पर नहीं जाएगा।",
    taglineGenre: "{genre}{laneNoun} — आधिकारिक प्रेस किट",
    taglinePlain: "{displayName} — आधिकारिक प्रेस किट",
    listName: "{displayName} — इनर सर्कल",
    listDescription:
      "{displayName} के नए ड्रॉप, शो और एक्सक्लूसिव सबसे पहले सुनें। कोई शोर नहीं — बस अच्छी चीज़ें।",
    welcomeSubject: "आप अंदर हैं — {displayName} के इनर सर्कल में आपका स्वागत है",
    welcomeBody:
      "घर में आपका स्वागत है।\n\nआप अभी-अभी उस सूची में शामिल हुए हैं जो सब कुछ सबसे पहले सुनती है — नई {genre}संगीत ड्रॉप, वीडियो, शो, और {displayName} के स्टोर एक्सक्लूसिव, कहीं और से पहले।\n\nयहाँ से शुरू करें: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "मैं घर बदल आया हूँ। 🏠 जो कुछ मैं बनाता हूँ — संगीत, वीडियो, स्टोर, सदस्यताएँ — अब एक ही जगह रहता है जो मेरी है: bowdownvisuals.com{homePath}। हमारे बीच कोई एल्गोरिदम नहीं। नया घर देखने आइए।",
    announcementOther:
      "मैं घर बदल आया हूँ। 🏠 जो कुछ मैं बनाता हूँ — वीडियो, काम, स्टोर, सदस्यताएँ — अब एक ही जगह रहता है जो मेरी है: bowdownvisuals.com{homePath}। हमारे बीच कोई एल्गोरिदम नहीं। नया घर देखने आइए।",
    tiktokCaption:
      "मैं घर बदल आया हूँ 🏠 जो कुछ मैं बनाता हूँ, अब एक ही जगह रहता है जो मेरी है — बायो में लिंक। bowdownvisuals.com{homePath}",
    facebookPageLabel: "Facebook पेज",
  },
  ar: {
    steps: {
      profile: {
        title: "ملفك الشخصي Grand Stage",
        blurb:
          "صفحتك الرئيسية — الاسم والسيرة والمجال وروابط التواصل من الحسابات التي ربطتها فعليًا.",
      },
      store: {
        title: "متجرك الأولي",
        blurb:
          "منتجاتك الأولى، مُعدّة من كتالوجك الخاص — تصبح متاحة في متجرك فور موافقتك عليها.",
      },
      press_kit: {
        title: "ملفك الصحفي",
        blurb:
          "ملف EPK قابل للمشاركة — سيرة وأبرز المقاطع وحساباتك المرتبطة — مُعدّ من ملفك الشخصي.",
      },
      email_list: {
        title: "قائمتك البريدية + الترحيب",
        blurb:
          "الجمهور الذي تملكه. قائمة معجبين مع رسالة ترحيب، جاهزة قبل وصول أول معجب.",
      },
      launch_posts: {
        title: "منشورات الإطلاق",
        blurb:
          "مسودات إعلان لكل حساب مرتبط، محفوظة في مُجدوِل المنشورات كمسودات — وأنت تختار متى تنطلق.",
      },
    },
    defaultCreatorName: "صانع جديد",
    laneNouns: {
      music: "فنان",
      video: "صانع فيديو",
      gaming: "مقدّم بث مباشر",
      podcast: "صانع بودكاست",
      film: "صانع أفلام",
      tv: "صانع عروض",
      influencer: "صانع محتوى",
      education: "معلّم",
      other: "صانع محتوى",
    },
    bioIntro: "{displayName} {laneNoun} {genre}يبني بيتًا لكل ما يصنعه{location}.",
    bioLocationClause: " — مقيم في {location}",
    bioKnownFrom: "ربما تعرف أعماله من {platforms} — الآن كل شيء يعيش في مكان واحد.",
    bioEverythingHere: "كل شيء يعيش هنا الآن — الموسيقى والفيديو والمتجر والعضويات، مباشرة من المصدر.",
    productDescription: "التنزيل الرسمي لـ \"{title}\" من {displayName} — لك، مباشرة من المصدر.",
    starterProductTitle: "{displayName} — حزمة الداعمين",
    starterProductDescription:
      "منتج أولي — عدّل هذا الوصف قبل الموافقة ليقول بالضبط ما يحصل عليه المشترون. لن يُعرض شيء للبيع حتى تقول أنت.",
    taglineGenre: "{laneNoun} {genre}— ملف صحفي رسمي",
    taglinePlain: "{displayName} — ملف صحفي رسمي",
    listName: "{displayName} — الدائرة الداخلية",
    listDescription:
      "أول من يسمع الإصدارات الجديدة والعروض والحصريات من {displayName}. بلا ضجيج — فقط الأفضل.",
    welcomeSubject: "أنت بالداخل — مرحبًا بك في الدائرة الداخلية لـ{displayName}",
    welcomeBody:
      "مرحبًا بك في بيتك.\n\nانضممت للتو إلى القائمة التي تسمع كل شيء أولًا — إصدارات {genre}موسيقى جديدة وفيديو وعروض وحصريات متجر {displayName}، قبل أي مكان آخر.\n\nابدأ هنا: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "انتقلت إلى بيتي. 🏠 كل ما أصنعه — الموسيقى والفيديو والمتجر والعضويات — يعيش الآن في مكان واحد أملكه: bowdownvisuals.com{homePath}. لا خوارزمية بيننا. تعال وشاهد البيت الجديد.",
    announcementOther:
      "انتقلت إلى بيتي. 🏠 كل ما أصنعه — الفيديو والعمل والمتجر والعضويات — يعيش الآن في مكان واحد أملكه: bowdownvisuals.com{homePath}. لا خوارزمية بيننا. تعال وشاهد البيت الجديد.",
    tiktokCaption:
      "انتقلت إلى بيتي 🏠 كل ما أصنعه يعيش الآن في مكان واحد أملكه — الرابط في السيرة. bowdownvisuals.com{homePath}",
    facebookPageLabel: "صفحة Facebook",
  },
  ja: {
    steps: {
      profile: {
        title: "あなたのGrand Stageプロフィール",
        blurb:
          "あなたのホームページ — 名前、プロフィール、ジャンル、そして実際に連携したアカウントのSNSリンク。",
      },
      store: {
        title: "あなたのスターターストア",
        blurb:
          "あなた自身のカタログから下書きした最初の商品 — 承認した瞬間にストアで公開されます。",
      },
      press_kit: {
        title: "あなたのプレスキット",
        blurb:
          "共有できるEPK — プロフィール文、代表曲、連携済みSNS — をあなたのプロフィールから下書きします。",
      },
      email_list: {
        title: "あなたのメールリスト＋ウェルカム",
        blurb:
          "あなたが所有するオーディエンス。ウェルカムメール付きのファンリストが、最初のファンが来る前に準備できます。",
      },
      launch_posts: {
        title: "あなたのローンチ投稿",
        blurb:
          "連携済みの各SNSへの告知下書きを、投稿スケジューラに下書きとして保存 — 投稿するタイミングはあなたが決めます。",
      },
    },
    defaultCreatorName: "新しいクリエイター",
    laneNouns: {
      music: "アーティスト",
      video: "動画クリエイター",
      gaming: "ストリーマー",
      podcast: "ポッドキャスター",
      film: "映画制作者",
      tv: "番組クリエイター",
      influencer: "クリエイター",
      education: "教育者",
      other: "クリエイター",
    },
    bioIntro: "{displayName}は、作るものすべての拠点を築いている{genre}{laneNoun}です{location}。",
    bioLocationClause: "（拠点：{location}）",
    bioKnownFrom: "{platforms}で作品を知っているかもしれません — 今はすべてが一つの場所にあります。",
    bioEverythingHere: "すべてが今ここにあります — 音楽、動画、ストア、メンバーシップ、すべて公式から直接。",
    productDescription: "{displayName}による「{title}」の公式ダウンロード — 公式から直接、あなたのものに。",
    starterProductTitle: "{displayName} — サポーターパック",
    starterProductDescription:
      "スターター商品 — 承認する前に、購入者が何を受け取るかを正確に伝えるよう、この説明を編集してください。あなたが言うまで、何も販売されません。",
    taglineGenre: "{genre}{laneNoun} — 公式プレスキット",
    taglinePlain: "{displayName} — 公式プレスキット",
    listName: "{displayName} — インナーサークル",
    listDescription:
      "{displayName}の新作、ライブ、限定情報をいち早くお届けします。ノイズなし — 良いものだけ。",
    welcomeSubject: "ようこそ — {displayName}のインナーサークルへ",
    welcomeBody:
      "おかえりなさい。\n\nあなたは今、すべてを最初に知るリストに参加しました — {displayName}の新しい{genre}音楽のリリース、動画、ライブ、ストア限定情報が、どこよりも先に届きます。\n\nここから始めてください：bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "引っ越しました。🏠 私が作るものすべて — 音楽、動画、ストア、メンバーシップ — は今、私が所有する一つの場所にあります：bowdownvisuals.com{homePath}。私たちの間にアルゴリズムはありません。新しい家を見に来てください。",
    announcementOther:
      "引っ越しました。🏠 私が作るものすべて — 動画、作品、ストア、メンバーシップ — は今、私が所有する一つの場所にあります：bowdownvisuals.com{homePath}。私たちの間にアルゴリズムはありません。新しい家を見に来てください。",
    tiktokCaption:
      "引っ越しました🏠 私が作るものは今、私が所有する一つの場所にあります — リンクはプロフィールに。bowdownvisuals.com{homePath}",
    facebookPageLabel: "Facebookページ",
  },
  ko: {
    steps: {
      profile: {
        title: "내 Grand Stage 프로필",
        blurb: "내 홈페이지 — 이름, 소개, 분야, 그리고 실제로 연결한 계정의 소셜 링크.",
      },
      store: {
        title: "내 스타터 스토어",
        blurb: "내 카탈로그에서 초안을 만든 첫 상품들 — 승인하는 순간 스토어에 바로 올라갑니다.",
      },
      press_kit: {
        title: "내 프레스 키트",
        blurb: "공유할 수 있는 EPK — 소개, 대표곡, 연결된 소셜 — 를 프로필에서 초안으로 만듭니다.",
      },
      email_list: {
        title: "내 이메일 리스트 + 환영 메일",
        blurb: "내가 소유한 관객. 첫 팬이 오기 전에 준비되는, 환영 메일이 있는 팬 리스트.",
      },
      launch_posts: {
        title: "내 런칭 게시물",
        blurb:
          "연결된 각 소셜의 공지 초안이 게시물 스케줄러에 초안으로 저장됩니다 — 언제 나갈지는 내가 정합니다.",
      },
    },
    defaultCreatorName: "새 크리에이터",
    laneNouns: {
      music: "아티스트",
      video: "영상 크리에이터",
      gaming: "스트리머",
      podcast: "팟캐스터",
      film: "영화 제작자",
      tv: "쇼 크리에이터",
      influencer: "크리에이터",
      education: "교육자",
      other: "크리에이터",
    },
    bioIntro: "{displayName}님은 만드는 모든 것을 위한 집을 짓고 있는 {genre}{laneNoun}입니다{location}.",
    bioLocationClause: " ({location} 기반)",
    bioKnownFrom: "{platforms}에서 작품을 아실 수도 있습니다 — 이제 모든 것이 한곳에 있습니다.",
    bioEverythingHere: "이제 모든 것이 여기에 있습니다 — 음악, 영상, 스토어, 멤버십, 모두 출처에서 직접.",
    productDescription: "{displayName}의 \"{title}\" 공식 다운로드 — 출처에서 직접, 당신의 것.",
    starterProductTitle: "{displayName} — 서포터 팩",
    starterProductDescription:
      "스타터 상품 — 승인하기 전에 이 설명을 편집해 구매자가 정확히 무엇을 받는지 알려주세요. 당신이 말하기 전에는 아무것도 판매되지 않습니다.",
    taglineGenre: "{genre}{laneNoun} — 공식 프레스 키트",
    taglinePlain: "{displayName} — 공식 프레스 키트",
    listName: "{displayName} — 이너 서클",
    listDescription:
      "{displayName}의 새 발매, 공연, 단독 소식을 가장 먼저 듣는 곳. 소음 없이 — 좋은 것만.",
    welcomeSubject: "들어오셨습니다 — {displayName}의 이너 서클에 오신 것을 환영합니다",
    welcomeBody:
      "집에 오신 것을 환영합니다.\n\n모든 것을 가장 먼저 듣는 리스트에 방금 가입하셨습니다 — {displayName}의 새로운 {genre}음악 발매, 영상, 공연, 스토어 단독 소식이 어디보다 먼저 도착합니다.\n\n여기서 시작하세요: bowdownvisuals.com{homePath}\n\n— {displayName}",
    announcementMusic:
      "이사했습니다. 🏠 제가 만드는 모든 것 — 음악, 영상, 스토어, 멤버십 — 이 이제 제가 소유한 한곳에 있습니다: bowdownvisuals.com{homePath}. 우리 사이에 알고리즘은 없습니다. 새 집을 보러 오세요.",
    announcementOther:
      "이사했습니다. 🏠 제가 만드는 모든 것 — 영상, 작업, 스토어, 멤버십 — 이 이제 제가 소유한 한곳에 있습니다: bowdownvisuals.com{homePath}. 우리 사이에 알고리즘은 없습니다. 새 집을 보러 오세요.",
    tiktokCaption:
      "이사했습니다 🏠 제가 만드는 모든 것이 이제 제가 소유한 한곳에 있습니다 — 링크는 프로필에. bowdownvisuals.com{homePath}",
    facebookPageLabel: "Facebook 페이지",
  },
};

/** The full Move Home copy block for a resolved locale. */
export function moveHomeCopyFor(locale: ServerLocale): MoveHomeCopy {
  return MOVE_HOME_COPY[locale];
}
