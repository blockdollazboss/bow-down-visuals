/**
 * Catalog Import copy, per locale (server side).
 *
 * What lives here: the server-composed template text of the
 * Back-Catalog Migration Assistant —
 *   - the honesty block (rendered verbatim by the page, returned in
 *     every state read) and the per-account verdict notes, both of
 *     which render per request in the caller's locale;
 *   - the per-row status notes the fetch rail stores on an item
 *     (no-file-URL, fetch-failed, too-large) and the rebuild draft's
 *     per-part notes — these are composed in the locale of the call
 *     that produced them and then stored; a stored note is the item's
 *     record and is never re-translated by a later read.
 *
 * What is NOT here: the creator's own data (their titles, captions,
 * transcripts — chapter labels come from their transcript text; only
 * the no-text fallback word is cataloged), provider error text
 * (a platform's own message passes through as-is), and the route's
 * CatalogImportError action errors, which stay English like every
 * other route's error strings. The one error whose text doubles as
 * a stored status note — the 800 MB limit — is cataloged here and
 * the fetch rail renders its stored note from the catalog.
 *
 * None of these strings carry interpolation placeholders.
 */
import type { ServerLocale } from "./server-i18n";

export interface CatalogImportCopy {
  honesty: {
    movesLine: string;
    tiktokBlocked: string;
    linkOnly: string;
    noFileUrl: string;
  };
  /** Account note + scan error for a Facebook connection with no Page. */
  facebookNoPage: string;
  /** Stored status note when a fetch fails for a non-catalog reason. */
  fetchFailedNote: string;
  /** The 800 MB import-limit text (error + stored status note). */
  fileTooLarge: string;
  draftNotes: {
    chaptersNoTimedSections: string;
    captionsUnavailable: string;
    chaptersNeedTranscript: string;
    thumbnailMissing: string;
    seriesNoMarker: string;
  };
  /** Transcript skip reasons recorded on the rebuild draft. */
  transcriptTooLarge: string;
  transcriptUnavailable: string;
  /** Fallback chapter label when a transcript segment has no text. */
  chapterFallback: string;
  /** Fallback title when a title cleans down to nothing. */
  untitledFallback: string;
}

export const CATALOG_IMPORT_COPY: Record<ServerLocale, CatalogImportCopy> = {
  en: {
    honesty: {
      movesLine:
        "Your work moves. Your followers don't — no platform lets anyone take an audience with them, and we won't pretend otherwise. What comes home is your content itself; your email list is how an audience becomes yours.",
      tiktokBlocked:
        "TikTok doesn't give apps a way to read or download your videos — the connection you granted covers posting only. Your TikTok catalog can't be pulled in automatically. Bring those files in with bulk upload below — that door always works.",
      linkOnly:
        "This is a display link you typed in, not a connected account — there's no connection that could read a catalog from it. Bulk upload below is the way in for this work.",
      noFileUrl:
        "The platform listed this post but wouldn't hand over the video file itself, so it can't be brought in automatically. Bulk upload the original file below and it comes home the same way.",
    },
    facebookNoPage:
      "This Facebook connection has no Page attached, and catalogs live on Pages. Reconnect in Settings and pick your Page.",
    fetchFailedNote:
      "The file couldn't be brought over. It may have expired on the platform — scan again to refresh it, then retry.",
    fileTooLarge:
      "That file is larger than the 800 MB import limit. Bring it in as a bulk upload instead — uploads don't pass through this server.",
    draftNotes: {
      chaptersNoTimedSections:
        "The transcript came back without timed sections, so there is nothing to hang chapters on.",
      captionsUnavailable: "Transcription wasn't available for this file.",
      chaptersNeedTranscript: "Chapters are built from the transcript — no transcript, no chapters.",
      thumbnailMissing: "No thumbnail came over with this file. You can set one after it's home.",
      seriesNoMarker:
        "No episode marker (like “Ep. 3” or “S2E3”) in the title, so no series grouping was suggested.",
    },
    transcriptTooLarge:
      "This file is too large to transcribe in one pass (200 MB), so captions and chapters were skipped — the rest of the rebuild still ran.",
    transcriptUnavailable:
      "Transcription wasn't available for this file, so captions and chapters were skipped — the rest of the rebuild still ran.",
    chapterFallback: "Chapter",
    untitledFallback: "Untitled",
  },
  es: {
    honesty: {
      movesLine:
        "Tu trabajo se muda. Tus seguidores no — ninguna plataforma permite que nadie se lleve a su audiencia, y no vamos a fingir lo contrario. Lo que vuelve a casa es tu contenido en sí; tu lista de correo es como una audiencia se vuelve tuya.",
      tiktokBlocked:
        "TikTok no da a las apps una forma de leer o descargar tus videos: la conexión que otorgaste cubre solo la publicación. Tu catálogo de TikTok no puede traerse automáticamente. Trae esos archivos con la carga masiva de abajo: esa puerta siempre funciona.",
      linkOnly:
        "Esto es un enlace visible que escribiste, no una cuenta conectada: no hay conexión que pueda leer un catálogo desde ahí. La carga masiva de abajo es la vía de entrada para este trabajo.",
      noFileUrl:
        "La plataforma mostró esta publicación pero no quiso entregar el archivo de video en sí, así que no puede traerse automáticamente. Sube el archivo original con la carga masiva de abajo y llegará a casa de la misma manera.",
    },
    facebookNoPage:
      "Esta conexión de Facebook no tiene una Página asociada, y los catálogos viven en las Páginas. Vuelve a conectar en Ajustes y elige tu Página.",
    fetchFailedNote:
      "El archivo no pudo traerse. Puede que haya vencido en la plataforma: vuelve a escanear para refrescarlo y luego reinténtalo.",
    fileTooLarge:
      "Ese archivo es más grande que el límite de importación de 800 MB. Tráelo mejor como carga masiva: las cargas no pasan por este servidor.",
    draftNotes: {
      chaptersNoTimedSections:
        "La transcripción volvió sin secciones con tiempos, así que no hay nada de qué colgar los capítulos.",
      captionsUnavailable: "La transcripción no estuvo disponible para este archivo.",
      chaptersNeedTranscript:
        "Los capítulos se construyen desde la transcripción: sin transcripción, no hay capítulos.",
      thumbnailMissing:
        "Ninguna miniatura vino con este archivo. Puedes poner una cuando ya esté en casa.",
      seriesNoMarker:
        "No hay marcador de episodio (como «Ep. 3» o «S2E3») en el título, así que no se sugirió agrupación en serie.",
    },
    transcriptTooLarge:
      "Este archivo es demasiado grande para transcribirlo de una pasada (200 MB), así que los subtítulos y los capítulos se saltaron — el resto de la reconstrucción sí se ejecutó.",
    transcriptUnavailable:
      "La transcripción no estuvo disponible para este archivo, así que los subtítulos y los capítulos se saltaron — el resto de la reconstrucción sí se ejecutó.",
    chapterFallback: "Capítulo",
    untitledFallback: "Sin título",
  },
  fr: {
    honesty: {
      movesLine:
        "Votre travail déménage. Vos abonnés, non — aucune plateforme ne permet à quiconque d'emporter son audience, et nous ne prétendrons pas le contraire. Ce qui rentre à la maison, c'est votre contenu lui-même ; votre liste e-mail est la façon dont une audience devient la vôtre.",
      tiktokBlocked:
        "TikTok ne donne aux applications aucun moyen de lire ou de télécharger vos vidéos — la connexion que vous avez accordée ne couvre que la publication. Votre catalogue TikTok ne peut pas être récupéré automatiquement. Apportez ces fichiers avec l'import en masse ci-dessous — cette porte fonctionne toujours.",
      linkOnly:
        "Ceci est un lien d'affichage que vous avez saisi, pas un compte connecté — aucune connexion ne pourrait en lire un catalogue. L'import en masse ci-dessous est la voie d'entrée pour ce travail.",
      noFileUrl:
        "La plateforme a listé cette publication mais n'a pas voulu remettre le fichier vidéo lui-même, donc il ne peut pas être récupéré automatiquement. Importez le fichier original en masse ci-dessous et il rentrera à la maison de la même façon.",
    },
    facebookNoPage:
      "Cette connexion Facebook n'a aucune Page rattachée, et les catalogues vivent sur les Pages. Reconnectez-vous dans les Paramètres et choisissez votre Page.",
    fetchFailedNote:
      "Le fichier n'a pas pu être récupéré. Il a peut-être expiré sur la plateforme — relancez une analyse pour l'actualiser, puis réessayez.",
    fileTooLarge:
      "Ce fichier dépasse la limite d'import de 800 Mo. Apportez-le plutôt en import en masse — les imports ne passent pas par ce serveur.",
    draftNotes: {
      chaptersNoTimedSections:
        "La transcription est revenue sans sections horodatées, donc rien ne permet d'accrocher des chapitres.",
      captionsUnavailable: "La transcription n'était pas disponible pour ce fichier.",
      chaptersNeedTranscript:
        "Les chapitres se construisent à partir de la transcription — pas de transcription, pas de chapitres.",
      thumbnailMissing:
        "Aucune miniature n'est arrivée avec ce fichier. Vous pourrez en définir une une fois qu'il sera à la maison.",
      seriesNoMarker:
        "Aucun marqueur d'épisode (comme « Ep. 3 » ou « S2E3 ») dans le titre, donc aucun regroupement en série n'a été suggéré.",
    },
    transcriptTooLarge:
      "Ce fichier est trop volumineux pour être transcrit en une seule passe (200 Mo), donc les sous-titres et les chapitres ont été ignorés — le reste de la reconstruction a bien eu lieu.",
    transcriptUnavailable:
      "La transcription n'était pas disponible pour ce fichier, donc les sous-titres et les chapitres ont été ignorés — le reste de la reconstruction a bien eu lieu.",
    chapterFallback: "Chapitre",
    untitledFallback: "Sans titre",
  },
  pt: {
    honesty: {
      movesLine:
        "Seu trabalho se muda. Seus seguidores, não — nenhuma plataforma permite que alguém leve um público consigo, e não vamos fingir o contrário. O que volta para casa é o seu conteúdo em si; sua lista de e-mail é como um público se torna seu.",
      tiktokBlocked:
        "O TikTok não oferece aos apps uma forma de ler ou baixar seus vídeos — a conexão que você concedeu cobre apenas a postagem. Seu catálogo do TikTok não pode ser trazido automaticamente. Traga esses arquivos pelo upload em massa abaixo — essa porta sempre funciona.",
      linkOnly:
        "Isso é um link de exibição que você digitou, não uma conta conectada — não há conexão que possa ler um catálogo a partir dele. O upload em massa abaixo é a via de entrada para esse trabalho.",
      noFileUrl:
        "A plataforma listou esta postagem, mas não quis entregar o arquivo de vídeo em si, então ele não pode ser trazido automaticamente. Faça o upload em massa do arquivo original abaixo e ele volta para casa do mesmo jeito.",
    },
    facebookNoPage:
      "Esta conexão do Facebook não tem uma Página vinculada, e os catálogos vivem nas Páginas. Reconecte em Configurações e escolha sua Página.",
    fetchFailedNote:
      "O arquivo não pôde ser trazido. Ele pode ter expirado na plataforma — escaneie de novo para atualizá-lo e tente outra vez.",
    fileTooLarge:
      "Esse arquivo é maior que o limite de importação de 800 MB. Traga-o como upload em massa — os uploads não passam por este servidor.",
    draftNotes: {
      chaptersNoTimedSections:
        "A transcrição voltou sem seções com tempo, então não há onde pendurar os capítulos.",
      captionsUnavailable: "A transcrição não estava disponível para este arquivo.",
      chaptersNeedTranscript:
        "Os capítulos são construídos a partir da transcrição — sem transcrição, sem capítulos.",
      thumbnailMissing:
        "Nenhuma miniatura veio com este arquivo. Você pode definir uma depois que ele estiver em casa.",
      seriesNoMarker:
        "Nenhum marcador de episódio (como “Ep. 3” ou “S2E3”) no título, então nenhum agrupamento em série foi sugerido.",
    },
    transcriptTooLarge:
      "Este arquivo é grande demais para transcrever de uma vez (200 MB), então as legendas e os capítulos foram pulados — o resto da reconstrução rodou normalmente.",
    transcriptUnavailable:
      "A transcrição não estava disponível para este arquivo, então as legendas e os capítulos foram pulados — o resto da reconstrução rodou normalmente.",
    chapterFallback: "Capítulo",
    untitledFallback: "Sem título",
  },
  de: {
    honesty: {
      movesLine:
        "Deine Arbeit zieht um. Deine Follower nicht — keine Plattform erlaubt es irgendjemandem, ein Publikum mitzunehmen, und wir tun nicht so, als wäre es anders. Was nach Hause kommt, ist dein Inhalt selbst; deine E-Mail-Liste ist der Weg, wie ein Publikum zu deinem wird.",
      tiktokBlocked:
        "TikTok gibt Apps keine Möglichkeit, deine Videos zu lesen oder herunterzuladen — die Verbindung, die du freigegeben hast, deckt nur das Posten ab. Dein TikTok-Katalog kann nicht automatisch geholt werden. Bring diese Dateien mit dem Massen-Upload unten herein — diese Tür funktioniert immer.",
      linkOnly:
        "Das ist ein Anzeigelink, den du eingetippt hast, kein verbundenes Konto — es gibt keine Verbindung, die daraus einen Katalog lesen könnte. Der Massen-Upload unten ist der Weg hinein für diese Arbeit.",
      noFileUrl:
        "Die Plattform hat diesen Beitrag aufgelistet, wollte aber die Videodatei selbst nicht herausgeben, also kann er nicht automatisch geholt werden. Lade die Originaldatei unten per Massen-Upload hoch, und sie kommt auf demselben Weg nach Hause.",
    },
    facebookNoPage:
      "Diese Facebook-Verbindung hat keine Seite angehängt, und Kataloge leben auf Seiten. Verbinde dich in den Einstellungen neu und wähle deine Seite.",
    fetchFailedNote:
      "Die Datei konnte nicht herübergebracht werden. Sie ist auf der Plattform vielleicht abgelaufen — scanne erneut, um sie zu aktualisieren, und versuch es dann noch einmal.",
    fileTooLarge:
      "Diese Datei ist größer als das Importlimit von 800 MB. Bring sie stattdessen als Massen-Upload herein — Uploads laufen nicht über diesen Server.",
    draftNotes: {
      chaptersNoTimedSections:
        "Das Transkript kam ohne zeitmarkierte Abschnitte zurück, also gibt es nichts, woran sich Kapitel aufhängen ließen.",
      captionsUnavailable: "Für diese Datei war keine Transkription verfügbar.",
      chaptersNeedTranscript: "Kapitel werden aus dem Transkript gebaut — kein Transkript, keine Kapitel.",
      thumbnailMissing:
        "Mit dieser Datei kam kein Vorschaubild herüber. Du kannst eines setzen, sobald sie zu Hause ist.",
      seriesNoMarker:
        "Kein Episodenmarker (wie „Ep. 3“ oder „S2E3“) im Titel, also wurde keine Serien-Gruppierung vorgeschlagen.",
    },
    transcriptTooLarge:
      "Diese Datei ist zu groß, um sie in einem Durchgang zu transkribieren (200 MB), also wurden Untertitel und Kapitel übersprungen — der Rest des Neuaufbaus lief normal.",
    transcriptUnavailable:
      "Für diese Datei war keine Transkription verfügbar, also wurden Untertitel und Kapitel übersprungen — der Rest des Neuaufbaus lief normal.",
    chapterFallback: "Kapitel",
    untitledFallback: "Ohne Titel",
  },
  it: {
    honesty: {
      movesLine:
        "Il tuo lavoro si trasferisce. I tuoi follower no — nessuna piattaforma permette a nessuno di portare via un pubblico, e non fingeremo il contrario. Ciò che torna a casa è il tuo contenuto stesso; la tua lista e-mail è il modo in cui un pubblico diventa tuo.",
      tiktokBlocked:
        "TikTok non offre alle app un modo per leggere o scaricare i tuoi video — la connessione che hai concesso copre solo la pubblicazione. Il tuo catalogo TikTok non può essere portato automaticamente. Porta quei file con il caricamento in massa qui sotto — quella porta funziona sempre.",
      linkOnly:
        "Questo è un link di visualizzazione che hai digitato, non un account collegato — non c'è nessuna connessione che possa leggerne un catalogo. Il caricamento in massa qui sotto è la via d'ingresso per questo lavoro.",
      noFileUrl:
        "La piattaforma ha elencato questo post ma non ha voluto consegnare il file video vero e proprio, quindi non può essere portato automaticamente. Carica in massa il file originale qui sotto e tornerà a casa allo stesso modo.",
    },
    facebookNoPage:
      "Questa connessione Facebook non ha una Pagina collegata, e i cataloghi vivono sulle Pagine. Riconnettiti nelle Impostazioni e scegli la tua Pagina.",
    fetchFailedNote:
      "Il file non è potuto essere portato. Potrebbe essere scaduto sulla piattaforma — scansiona di nuovo per aggiornarlo, poi riprova.",
    fileTooLarge:
      "Quel file supera il limite di importazione di 800 MB. Portalo invece come caricamento in massa — i caricamenti non passano da questo server.",
    draftNotes: {
      chaptersNoTimedSections:
        "La trascrizione è tornata senza sezioni temporizzate, quindi non c'è nulla a cui agganciare i capitoli.",
      captionsUnavailable: "La trascrizione non era disponibile per questo file.",
      chaptersNeedTranscript:
        "I capitoli si costruiscono dalla trascrizione — niente trascrizione, niente capitoli.",
      thumbnailMissing:
        "Nessuna miniatura è arrivata con questo file. Potrai impostarne una quando sarà a casa.",
      seriesNoMarker:
        "Nessun marcatore di episodio (come “Ep. 3” o “S2E3”) nel titolo, quindi non è stato suggerito nessun raggruppamento in serie.",
    },
    transcriptTooLarge:
      "Questo file è troppo grande per essere trascritto in un solo passaggio (200 MB), quindi sottotitoli e capitoli sono stati saltati — il resto della ricostruzione è stato eseguito.",
    transcriptUnavailable:
      "La trascrizione non era disponibile per questo file, quindi sottotitoli e capitoli sono stati saltati — il resto della ricostruzione è stato eseguito.",
    chapterFallback: "Capitolo",
    untitledFallback: "Senza titolo",
  },
  hi: {
    honesty: {
      movesLine:
        "आपका काम घर आता है। आपके फ़ॉलोअर नहीं — कोई भी प्लेटफ़ॉर्म किसी को अपना दर्शक साथ ले जाने नहीं देता, और हम ऐसा दिखावा नहीं करेंगे। जो घर आता है, वह आपकी सामग्री खुद है; आपकी ईमेल सूची ही वह तरीका है जिससे दर्शक आपके बनते हैं।",
      tiktokBlocked:
        "TikTok ऐप्स को आपके वीडियो पढ़ने या डाउनलोड करने का कोई तरीका नहीं देता — आपने जो कनेक्शन दिया है, वह केवल पोस्ट करने के लिए है। आपका TikTok कैटलॉग अपने आप नहीं लाया जा सकता। उन फ़ाइलों को नीचे दिए बल्क अपलोड से लाएँ — वह दरवाज़ा हमेशा काम करता है।",
      linkOnly:
        "यह एक डिस्प्ले लिंक है जो आपने टाइप किया था, कोई कनेक्टेड अकाउंट नहीं — ऐसा कोई कनेक्शन नहीं है जो इससे कैटलॉग पढ़ सके। इस काम के लिए नीचे दिया बल्क अपलोड ही रास्ता है।",
      noFileUrl:
        "प्लेटफ़ॉर्म ने यह पोस्ट सूची में दिखाई, लेकिन वीडियो फ़ाइल खुद देने से इनकार कर दिया, इसलिए इसे अपने आप नहीं लाया जा सकता। मूल फ़ाइल को नीचे बल्क अपलोड करें, वह उसी तरह घर आ जाएगी।",
    },
    facebookNoPage:
      "इस Facebook कनेक्शन के साथ कोई पेज जुड़ा नहीं है, और कैटलॉग पेजों पर रहते हैं। Settings में फिर से कनेक्ट करें और अपना पेज चुनें।",
    fetchFailedNote:
      "फ़ाइल लाई नहीं जा सकी। हो सकता है वह प्लेटफ़ॉर्म पर समाप्त हो गई हो — उसे ताज़ा करने के लिए फिर से स्कैन करें, फिर दोबारा कोशिश करें।",
    fileTooLarge:
      "वह फ़ाइल 800 MB की आयात सीमा से बड़ी है। इसके बजाय इसे बल्क अपलोड के रूप में लाएँ — अपलोड इस सर्वर से होकर नहीं गुज़रते।",
    draftNotes: {
      chaptersNoTimedSections:
        "ट्रांसक्रिप्ट समय-चिह्नित खंडों के बिना वापस आया, इसलिए अध्याय टांगने के लिए कुछ नहीं है।",
      captionsUnavailable: "इस फ़ाइल के लिए ट्रांसक्रिप्शन उपलब्ध नहीं था।",
      chaptersNeedTranscript: "अध्याय ट्रांसक्रिप्ट से बनते हैं — ट्रांसक्रिप्ट नहीं, तो अध्याय नहीं।",
      thumbnailMissing: "इस फ़ाइल के साथ कोई थंबनेल नहीं आया। घर आने के बाद आप एक लगा सकते हैं।",
      seriesNoMarker:
        "शीर्षक में कोई एपिसोड मार्कर (जैसे “Ep. 3” या “S2E3”) नहीं है, इसलिए कोई सीरीज़ समूहीकरण सुझाया नहीं गया।",
    },
    transcriptTooLarge:
      "यह फ़ाइल एक बार में ट्रांसक्राइब करने के लिए बहुत बड़ी है (200 MB), इसलिए कैप्शन और अध्याय छोड़ दिए गए — बाकी पुनर्निर्माण चल गया।",
    transcriptUnavailable:
      "इस फ़ाइल के लिए ट्रांसक्रिप्शन उपलब्ध नहीं था, इसलिए कैप्शन और अध्याय छोड़ दिए गए — बाकी पुनर्निर्माण चल गया।",
    chapterFallback: "अध्याय",
    untitledFallback: "बिना शीर्षक",
  },
  ar: {
    honesty: {
      movesLine:
        "أعمالك تنتقل معك. متابعوك لا — لا تسمح أي منصة لأحد بأخذ جمهوره معه، ولن ندّعي غير ذلك. ما يعود إلى البيت هو محتواك نفسه؛ وقائمتك البريدية هي الطريقة التي يصبح بها الجمهور جمهورك.",
      tiktokBlocked:
        "لا يمنح TikTok التطبيقات أي طريقة لقراءة مقاطعك أو تنزيلها — الاتصال الذي منحته يغطي النشر فقط. لا يمكن جلب كتالوج TikTok الخاص بك تلقائيًا. أحضر تلك الملفات عبر الرفع الجماعي أدناه — ذلك الباب يعمل دائمًا.",
      linkOnly:
        "هذا رابط عرض كتبته بنفسك، وليس حسابًا مرتبطًا — لا يوجد اتصال يمكنه قراءة كتالوج منه. الرفع الجماعي أدناه هو طريق الدخول لهذا العمل.",
      noFileUrl:
        "أدرجت المنصة هذا المنشور لكنها لم تسلّم ملف الفيديو نفسه، لذا لا يمكن جلبه تلقائيًا. ارفع الملف الأصلي جماعيًا أدناه وسيعود إلى البيت بالطريقة نفسها.",
    },
    facebookNoPage:
      "اتصال Facebook هذا ليس له صفحة مرتبطة، والكتالوجات تعيش على الصفحات. أعد الاتصال في الإعدادات واختر صفحتك.",
    fetchFailedNote:
      "تعذّر جلب الملف. ربما انتهت صلاحيته على المنصة — امسح من جديد لتحديثه، ثم حاول مرة أخرى.",
    fileTooLarge:
      "ذلك الملف أكبر من حد الاستيراد البالغ 800 MB. أحضره كرفع جماعي بدلًا من ذلك — عمليات الرفع لا تمر عبر هذا الخادم.",
    draftNotes: {
      chaptersNoTimedSections: "عاد النص المفرّغ دون مقاطع موقوتة، فلا يوجد ما تُعلَّق عليه الفصول.",
      captionsUnavailable: "لم يكن التفريغ متاحًا لهذا الملف.",
      chaptersNeedTranscript: "تُبنى الفصول من النص المفرّغ — لا نص مفرّغ، لا فصول.",
      thumbnailMissing: "لم تصل أي صورة مصغّرة مع هذا الملف. يمكنك تعيين واحدة بعد أن يصل إلى البيت.",
      seriesNoMarker:
        "لا توجد علامة حلقة (مثل “Ep. 3” أو “S2E3”) في العنوان، لذا لم يُقترح أي تجميع في سلسلة.",
    },
    transcriptTooLarge:
      "هذا الملف كبير جدًا على التفريغ في مرة واحدة (200 MB)، لذا تُركت التسميات التوضيحية والفصول — وبقية إعادة البناء تمت.",
    transcriptUnavailable:
      "لم يكن التفريغ متاحًا لهذا الملف، لذا تُركت التسميات التوضيحية والفصول — وبقية إعادة البناء تمت.",
    chapterFallback: "فصل",
    untitledFallback: "بدون عنوان",
  },
  ja: {
    honesty: {
      movesLine:
        "あなたの作品は引っ越せます。フォロワーは引っ越せません — どのプラットフォームも、オーディエンスを持ち出すことは誰にも認めておらず、私たちもそうであるかのように振る舞いません。家に帰ってくるのはコンテンツそのもの。あなたのメールリストこそが、オーディエンスをあなたのものにする方法です。",
      tiktokBlocked:
        "TikTokはアプリにあなたの動画を読み取ったりダウンロードしたりする手段を提供していません — あなたが許可した連携は投稿専用です。TikTokカタログを自動で取り込むことはできません。下の一括アップロードでファイルを持ってきてください — そのドアはいつでも使えます。",
      linkOnly:
        "これはあなたが入力した表示用リンクであり、連携済みアカウントではありません — ここからカタログを読み取れる連携は存在しません。この作品の入り口は、下の一括アップロードです。",
      noFileUrl:
        "プラットフォームはこの投稿を一覧に載せましたが、動画ファイル自体は渡してくれなかったため、自動では取り込めません。下で元のファイルを一括アップロードすれば、同じように家に帰ってきます。",
    },
    facebookNoPage:
      "このFacebook連携にはページが紐づいておらず、カタログはページ上にあります。設定で再連携して、ページを選んでください。",
    fetchFailedNote:
      "ファイルを持ってくることができませんでした。プラットフォーム上で期限切れになっている可能性があります — 再スキャンして更新してから、もう一度お試しください。",
    fileTooLarge:
      "そのファイルは800 MBのインポート上限を超えています。代わりに一括アップロードで持ってきてください — アップロードはこのサーバーを経由しません。",
    draftNotes: {
      chaptersNoTimedSections:
        "文字起こしに時間付きの区切りがなかったため、チャプターを掛ける場所がありません。",
      captionsUnavailable: "このファイルでは文字起こしが利用できませんでした。",
      chaptersNeedTranscript:
        "チャプターは文字起こしから作られます — 文字起こしがなければチャプターもありません。",
      thumbnailMissing: "このファイルにはサムネイルが付いてきませんでした。家に帰ってから設定できます。",
      seriesNoMarker:
        "タイトルにエピソードマーカー（「Ep. 3」や「S2E3」など）がないため、シリーズのグループ化は提案されませんでした。",
    },
    transcriptTooLarge:
      "このファイルは一回の文字起こしには大きすぎるため（200 MB）、キャプションとチャプターはスキップされました — 再構築の残りは実行されました。",
    transcriptUnavailable:
      "このファイルでは文字起こしが利用できなかったため、キャプションとチャプターはスキップされました — 再構築の残りは実行されました。",
    chapterFallback: "チャプター",
    untitledFallback: "無題",
  },
  ko: {
    honesty: {
      movesLine:
        "내 작품은 이사합니다. 팔로워는 이사하지 않습니다 — 어떤 플랫폼도 누군가가 관객을 데려가는 것을 허용하지 않으며, 우리도 그런 척하지 않습니다. 집으로 돌아오는 것은 콘텐츠 그 자체이고, 이메일 리스트가 관객을 내 것으로 만드는 방법입니다.",
      tiktokBlocked:
        "TikTok은 앱이 내 영상을 읽거나 다운로드할 방법을 제공하지 않습니다 — 내가 허용한 연결은 게시 전용입니다. TikTok 카탈로그는 자동으로 가져올 수 없습니다. 아래의 대량 업로드로 파일들을 가져오세요 — 그 문은 언제나 열려 있습니다.",
      linkOnly:
        "이것은 내가 입력한 표시용 링크이지 연결된 계정이 아닙니다 — 여기서 카탈로그를 읽을 수 있는 연결은 없습니다. 이 작업의 입구는 아래의 대량 업로드입니다.",
      noFileUrl:
        "플랫폼이 이 게시물을 목록에 올렸지만 영상 파일 자체는 넘겨주지 않아 자동으로 가져올 수 없습니다. 아래에서 원본 파일을 대량 업로드하면 같은 방식으로 집에 돌아옵니다.",
    },
    facebookNoPage:
      "이 Facebook 연결에는 페이지가 연결되어 있지 않으며, 카탈로그는 페이지에 있습니다. 설정에서 다시 연결하고 페이지를 선택하세요.",
    fetchFailedNote:
      "파일을 가져오지 못했습니다. 플랫폼에서 만료되었을 수 있습니다 — 다시 스캔해 새로고침한 뒤 재시도하세요.",
    fileTooLarge:
      "그 파일은 800MB 가져오기 제한보다 큽니다. 대신 대량 업로드로 가져오세요 — 업로드는 이 서버를 거치지 않습니다.",
    draftNotes: {
      chaptersNoTimedSections: "자막 텍스트가 시간 표시 구간 없이 돌아와 챕터를 걸 곳이 없습니다.",
      captionsUnavailable: "이 파일은 전사가 불가능했습니다.",
      chaptersNeedTranscript: "챕터는 전사 텍스트로 만들어집니다 — 전사가 없으면 챕터도 없습니다.",
      thumbnailMissing: "이 파일과 함께 온 썸네일이 없습니다. 집에 온 뒤에 설정할 수 있습니다.",
      seriesNoMarker:
        "제목에 에피소드 표식(“Ep. 3”나 “S2E3” 같은)이 없어 시리즈 그룹핑이 제안되지 않았습니다.",
    },
    transcriptTooLarge:
      "이 파일은 한 번에 전사하기에는 너무 커서(200MB) 캡션과 챕터가 건너뛰어졌습니다 — 재구성의 나머지는 실행되었습니다.",
    transcriptUnavailable:
      "이 파일은 전사가 불가능해서 캡션과 챕터가 건너뛰어졌습니다 — 재구성의 나머지는 실행되었습니다.",
    chapterFallback: "챕터",
    untitledFallback: "제목 없음",
  },
};

/** The full Catalog Import copy block for a resolved locale. */
export function catalogImportCopyFor(locale: ServerLocale): CatalogImportCopy {
  return CATALOG_IMPORT_COPY[locale];
}
