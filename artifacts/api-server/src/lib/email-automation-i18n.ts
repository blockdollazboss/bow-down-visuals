/**
 * Email automation copy, per locale (server side).
 *
 * The frontend's language choice lives only in the browser
 * (localStorage "bdv-language" — see the web app's lib/i18n.ts);
 * the server keeps NO stored language preference for a member, so
 * the automations endpoints resolve a locale per request:
 *   1. an explicit `locale` field on the request (JSON body on
 *      PATCH, query string on GET) — the email-list page sends the
 *      creator's current language;
 *   2. English.
 * (Resolution order is pinned in email-automation-i18n.test.ts.)
 *
 * What lives here: the automation NAMES (labels), the plain-language
 * trigger explanations, and the seeded starter copy (subject/body)
 * a NEW automation is provisioned with. An existing automation's
 * stored subject/body is the creator's own data — it is never
 * rewritten or re-translated by locale; only the label and trigger
 * note are rendered per request.
 *
 * House conventions: "Visual Bucs", "Bow Down Visuals" and
 * "Thy Cheat Code" are never translated. None of these strings
 * carry interpolation placeholders today; the test suite pins
 * placeholder parity across locales so a future placeholder lands
 * in every language at once.
 */
import type { EmailAutomationKind } from "@workspace/db";
import {
  SERVER_LOCALES,
  normalizeServerLocale,
  resolveServerLocale,
  type ServerLocale,
} from "./server-i18n";

/* The locale list and the normalize/resolve primitives are the shared
   server core (lib/server-i18n) — this surface re-exports them under
   its own names so every server catalog resolves identically. */
export const AUTOMATION_LOCALES = SERVER_LOCALES;

export type AutomationLocale = ServerLocale;

export const normalizeAutomationLocale = normalizeServerLocale;

export const resolveAutomationLocale = resolveServerLocale;

export interface AutomationDefaultCopy {
  subject: string;
  body: string;
  delayHours: number;
}

export interface AutomationCopy {
  labels: Record<EmailAutomationKind, string>;
  triggerNotes: Record<EmailAutomationKind, string>;
  defaults: Record<EmailAutomationKind, AutomationDefaultCopy>;
}

export const AUTOMATION_COPY: Record<AutomationLocale, AutomationCopy> = {
  en: {
    labels: {
      post_purchase: "Post-purchase thank-you",
      abandoned_checkout: "Abandoned checkout",
      membership_winback: "Membership winback",
      membership_payment_recovery: "Membership payment recovery",
    },
    triggerNotes: {
      post_purchase:
        "Fires once per completed purchase — a sale in your shop (one email per checkout, however many items) or a paid download. Only confirmed paid sales count.",
      abandoned_checkout:
        "Fires when a checkout is started but left unpaid until it closes — a shop checkout that never pays, or a checkout in your store or on your profile that expires unpaid (an unpaid checkout closes about a day after it starts). One email per checkout.",
      membership_winback:
        "Fires when a fan's membership is canceled or expires. The fan is emailed at the address on their account, or the email you recorded for them.",
      membership_payment_recovery:
        "Fires when a fan's membership payment fails and the membership is past due: a notice at the failure, a reminder after 3 days, a card-update nudge after 5 days, and a final warning after 6 days — one day before access pauses at the end of the 7-day grace. The first email uses the subject and body here; the later steps use fixed recovery wording so the dates fans are told never drift.",
    },
    defaults: {
      post_purchase: {
        subject: "Thank you for your purchase!",
        body:
          "Hi there,\n\nThank you for buying from my shop — it means a lot, and it directly helps me keep creating.\n\n" +
          "If anything about your order needs attention, just reply to this email.\n\nMore is on the way — stay close.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "You left something behind",
        body:
          "Hi there,\n\nYou started checking out in my shop but didn't finish — your picks are still waiting for you.\n\n" +
          "Head back to the shop any time to complete your order. No pressure, and thanks for looking.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "We miss you — your membership is waiting",
        body:
          "Hi there,\n\nYour membership recently ended, and the door is still open. Everything you loved is still here, " +
          "plus everything new since you've been gone.\n\nCome back any time — we'd love to have you again.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "Your membership payment didn't go through",
        body:
          "Hi there,\n\nWe tried to take the payment for your membership and it didn't go through — " +
          "this happens with expired cards, replaced cards, and banks being careful.\n\n" +
          "Your membership is still on for now. You have 7 days from the failed payment to update " +
          "your card before access pauses. Update it any time from Your Memberships on Bow Down Visuals " +
          "(/memberships) — you'll enter your new card on Stripe's secure page.\n\n" +
          "If you already fixed it, you can ignore this — a successful payment ends these reminders.",
        delayHours: 0,
      },
    },
  },
  es: {
    labels: {
      post_purchase: "Agradecimiento poscompra",
      abandoned_checkout: "Pago abandonado",
      membership_winback: "Recuperación de membresía",
      membership_payment_recovery: "Recuperación de pago de membresía",
    },
    triggerNotes: {
      post_purchase:
        "Se activa una vez por cada compra completada: una venta en tu tienda (un correo por pago, sin importar cuántos artículos) o una descarga pagada. Solo cuentan las ventas confirmadas como pagadas.",
      abandoned_checkout:
        "Se activa cuando un pago comienza pero queda sin pagar hasta que se cierra: un pago en tu tienda que nunca se paga, o un pago en tu tienda o en tu perfil que expira sin pagarse (un pago sin pagar se cierra aproximadamente un día después de comenzar). Un correo por pago.",
      membership_winback:
        "Se activa cuando la membresía de un fan se cancela o vence. El correo se envía a la dirección de su cuenta, o a la dirección que registraste para esa persona.",
      membership_payment_recovery:
        "Se activa cuando el pago de la membresía de un fan falla y la membresía queda vencida: un aviso en el momento del fallo, un recordatorio a los 3 días, un aviso para actualizar la tarjeta a los 5 días y una advertencia final a los 6 días, un día antes de que el acceso se pause al final del periodo de gracia de 7 días. El primer correo usa el asunto y el cuerpo de aquí; los pasos siguientes usan textos fijos de recuperación para que las fechas comunicadas nunca cambien.",
    },
    defaults: {
      post_purchase: {
        subject: "¡Gracias por tu compra!",
        body:
          "Hola,\n\nGracias por comprar en mi tienda: significa mucho y me ayuda directamente a seguir creando.\n\n" +
          "Si algo de tu pedido necesita atención, solo responde a este correo.\n\nHay más en camino: mantente cerca.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "Dejaste algo olvidado",
        body:
          "Hola,\n\nEmpezaste a pagar en mi tienda pero no terminaste: tus artículos siguen esperándote.\n\n" +
          "Vuelve a la tienda cuando quieras para completar tu pedido. Sin presión, y gracias por mirar.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "Te extrañamos: tu membresía te espera",
        body:
          "Hola,\n\nTu membresía terminó hace poco y la puerta sigue abierta. Todo lo que te encantaba sigue aquí, " +
          "además de todo lo nuevo desde que te fuiste.\n\nVuelve cuando quieras: nos encantaría tenerte de nuevo.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "El pago de tu membresía no se pudo procesar",
        body:
          "Hola,\n\nIntentamos cobrar el pago de tu membresía y no se pudo procesar: " +
          "esto pasa con tarjetas vencidas, tarjetas reemplazadas y bancos precavidos.\n\n" +
          "Tu membresía sigue activa por ahora. Tienes 7 días desde el pago fallido para actualizar " +
          "tu tarjeta antes de que el acceso se pause. Actualízala cuando quieras desde Tus Membresías en Bow Down Visuals " +
          "(/memberships): ingresarás tu nueva tarjeta en la página segura de Stripe.\n\n" +
          "Si ya lo resolviste, puedes ignorar esto: un pago exitoso detiene estos recordatorios.",
        delayHours: 0,
      },
    },
  },
  fr: {
    labels: {
      post_purchase: "Remerciement après achat",
      abandoned_checkout: "Paiement abandonné",
      membership_winback: "Reconquête d'abonnement",
      membership_payment_recovery: "Récupération de paiement d'abonnement",
    },
    triggerNotes: {
      post_purchase:
        "Se déclenche une fois par achat terminé : une vente dans votre boutique (un e-mail par paiement, quel que soit le nombre d'articles) ou un téléchargement payé. Seules les ventes confirmées comme payées comptent.",
      abandoned_checkout:
        "Se déclenche quand un paiement commence mais reste impayé jusqu'à sa fermeture : un paiement dans votre boutique qui n'aboutit jamais, ou un paiement dans votre boutique ou sur votre profil qui expire sans être payé (un paiement impayé se ferme environ un jour après son début). Un e-mail par paiement.",
      membership_winback:
        "Se déclenche quand l'abonnement d'un fan est annulé ou expire. L'e-mail est envoyé à l'adresse de son compte, ou à l'adresse que vous avez notée pour lui.",
      membership_payment_recovery:
        "Se déclenche quand le paiement de l'abonnement d'un fan échoue et que l'abonnement devient impayé : un avis au moment de l'échec, un rappel après 3 jours, un avis de mise à jour de la carte après 5 jours et un dernier avertissement après 6 jours — un jour avant la pause de l'accès à la fin du délai de grâce de 7 jours. Le premier e-mail utilise l'objet et le corps ci-dessus ; les étapes suivantes utilisent des textes de récupération fixes pour que les dates annoncées ne changent jamais.",
    },
    defaults: {
      post_purchase: {
        subject: "Merci pour votre achat !",
        body:
          "Bonjour,\n\nMerci d'avoir acheté dans ma boutique — cela compte énormément et m'aide directement à continuer de créer.\n\n" +
          "Si quoi que ce soit dans votre commande demande attention, répondez simplement à cet e-mail.\n\nLa suite arrive bientôt — restez proche.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "Vous avez laissé quelque chose derrière vous",
        body:
          "Bonjour,\n\nVous avez commencé un paiement dans ma boutique sans le terminer — vos articles vous attendent toujours.\n\n" +
          "Revenez à la boutique quand vous voulez pour finaliser votre commande. Sans pression, et merci pour votre visite.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "Vous nous manquez — votre abonnement vous attend",
        body:
          "Bonjour,\n\nVotre abonnement s'est terminé récemment, et la porte reste ouverte. Tout ce que vous aimiez est toujours là, " +
          "plus tout ce qui est nouveau depuis votre départ.\n\nRevenez quand vous voulez — nous serions ravis de vous revoir.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "Le paiement de votre abonnement n'a pas abouti",
        body:
          "Bonjour,\n\nNous avons essayé de prélever le paiement de votre abonnement et il n'a pas abouti : " +
          "cela arrive avec des cartes expirées, des cartes remplacées et des banques prudentes.\n\n" +
          "Votre abonnement reste actif pour l'instant. Vous avez 7 jours à partir du paiement échoué pour mettre à jour " +
          "votre carte avant que l'accès ne soit mis en pause. Mettez-la à jour à tout moment depuis Vos Abonnements sur Bow Down Visuals " +
          "(/memberships) — vous saisirez votre nouvelle carte sur la page sécurisée de Stripe.\n\n" +
          "Si c'est déjà réglé, ignorez ce message : un paiement réussi met fin à ces rappels.",
        delayHours: 0,
      },
    },
  },
  pt: {
    labels: {
      post_purchase: "Agradecimento pós-compra",
      abandoned_checkout: "Compra abandonada",
      membership_winback: "Recuperação de assinatura",
      membership_payment_recovery: "Recuperação de pagamento de assinatura",
    },
    triggerNotes: {
      post_purchase:
        "Dispara uma vez por compra concluída — uma venda na sua loja (um e-mail por finalização, não importa quantos itens) ou um download pago. Só contam vendas confirmadas como pagas.",
      abandoned_checkout:
        "Dispara quando uma compra começa, mas fica sem pagamento até ser encerrada — uma compra na sua loja que nunca é paga, ou uma compra na sua loja ou no seu perfil que expira sem pagamento (uma compra não paga é encerrada cerca de um dia depois de começar). Um e-mail por compra.",
      membership_winback:
        "Dispara quando a assinatura de um fã é cancelada ou expira. O e-mail vai para o endereço da conta dele, ou para o endereço que você registrou para ele.",
      membership_payment_recovery:
        "Dispara quando o pagamento da assinatura de um fã falha e a assinatura fica em atraso: um aviso na falha, um lembrete após 3 dias, um aviso para atualizar o cartão após 5 dias e um aviso final após 6 dias — um dia antes de o acesso pausar no fim do período de carência de 7 dias. O primeiro e-mail usa o assunto e o corpo aqui; as etapas seguintes usam textos fixos de recuperação para que as datas informadas nunca mudem.",
    },
    defaults: {
      post_purchase: {
        subject: "Obrigado pela sua compra!",
        body:
          "Olá,\n\nObrigado por comprar na minha loja — isso significa muito e me ajuda diretamente a continuar criando.\n\n" +
          "Se algo no seu pedido precisar de atenção, é só responder a este e-mail.\n\nTem mais a caminho — fique por perto.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "Você deixou algo para trás",
        body:
          "Olá,\n\nVocê começou a finalizar uma compra na minha loja, mas não concluiu — seus itens ainda estão esperando por você.\n\n" +
          "Volte à loja quando quiser para concluir seu pedido. Sem pressão, e obrigado pela visita.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "Sentimos sua falta — sua assinatura está esperando",
        body:
          "Olá,\n\nSua assinatura terminou recentemente, e a porta continua aberta. Tudo o que você amava continua aqui, " +
          "além de tudo o que há de novo desde que você saiu.\n\nVolte quando quiser — adoraríamos ter você de volta.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "O pagamento da sua assinatura não foi concluído",
        body:
          "Olá,\n\nTentamos cobrar o pagamento da sua assinatura e ele não foi concluído: " +
          "isso acontece com cartões vencidos, cartões substituídos e bancos cautelosos.\n\n" +
          "Sua assinatura continua ativa por enquanto. Você tem 7 dias a partir do pagamento falho para atualizar " +
          "seu cartão antes que o acesso pause. Atualize quando quiser em Suas Assinaturas no Bow Down Visuals " +
          "(/memberships) — você digitará o novo cartão na página segura da Stripe.\n\n" +
          "Se você já resolveu, pode ignorar isto — um pagamento bem-sucedido encerra estes lembretes.",
        delayHours: 0,
      },
    },
  },
  de: {
    labels: {
      post_purchase: "Dankeschön nach dem Kauf",
      abandoned_checkout: "Abgebrochener Kauf",
      membership_winback: "Mitgliedschaft zurückgewinnen",
      membership_payment_recovery: "Zahlungswiederherstellung für Mitgliedschaften",
    },
    triggerNotes: {
      post_purchase:
        "Wird einmal pro abgeschlossenem Kauf ausgelöst — ein Verkauf in deinem Shop (eine E-Mail pro Kaufvorgang, egal wie viele Artikel) oder ein bezahlter Download. Es zählen nur bestätigte, bezahlte Verkäufe.",
      abandoned_checkout:
        "Wird ausgelöst, wenn ein Kauf begonnen, aber bis zu seinem Abschluss nicht bezahlt wird — ein Kauf in deinem Shop, der nie bezahlt wird, oder ein Kauf in deinem Store oder auf deinem Profil, der unbezahlt abläuft (ein unbezahlter Kauf wird etwa einen Tag nach seinem Beginn geschlossen). Eine E-Mail pro Kauf.",
      membership_winback:
        "Wird ausgelöst, wenn die Mitgliedschaft eines Fans gekündigt wird oder ausläuft. Die E-Mail geht an die Adresse seines Kontos oder an die Adresse, die du für ihn notiert hast.",
      membership_payment_recovery:
        "Wird ausgelöst, wenn die Zahlung eines Fans fehlschlägt und die Mitgliedschaft überfällig wird: ein Hinweis beim Fehlschlag, eine Erinnerung nach 3 Tagen, ein Hinweis zur Kartenaktualisierung nach 5 Tagen und eine letzte Warnung nach 6 Tagen — einen Tag bevor der Zugang am Ende der 7-tägigen Schonfrist pausiert. Die erste E-Mail nutzt Betreff und Text von hier; die späteren Schritte nutzen feste Wiederherstellungstexte, damit die genannten Daten nie abweichen.",
    },
    defaults: {
      post_purchase: {
        subject: "Danke für deinen Kauf!",
        body:
          "Hallo,\n\nDanke, dass du in meinem Shop gekauft hast — das bedeutet mir viel und hilft mir direkt, weiter kreativ zu arbeiten.\n\n" +
          "Wenn bei deiner Bestellung etwas nicht stimmt, antworte einfach auf diese E-Mail.\n\nEs ist mehr unterwegs — bleib dran.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "Du hast etwas liegen lassen",
        body:
          "Hallo,\n\nDu hast in meinem Shop einen Kauf begonnen, aber nicht abgeschlossen — deine Auswahl wartet noch auf dich.\n\n" +
          "Kehre jederzeit in den Shop zurück, um deine Bestellung abzuschließen. Kein Druck, und danke fürs Vorbeischauen.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "Wir vermissen dich — deine Mitgliedschaft wartet",
        body:
          "Hallo,\n\nDeine Mitgliedschaft ist vor Kurzem zu Ende gegangen, und die Tür steht weiter offen. Alles, was du geliebt hast, ist noch da — " +
          "plus alles Neue seit deinem Weggang.\n\nKomm jederzeit zurück — wir würden uns freuen, dich wieder hier zu haben.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "Die Zahlung deiner Mitgliedschaft ist fehlgeschlagen",
        body:
          "Hallo,\n\nWir haben versucht, die Zahlung für deine Mitgliedschaft abzubuchen, und es hat nicht geklappt — " +
          "das passiert bei abgelaufenen Karten, ersetzten Karten und vorsichtigen Banken.\n\n" +
          "Deine Mitgliedschaft läuft vorerst weiter. Du hast 7 Tage ab der fehlgeschlagenen Zahlung Zeit, deine Karte zu aktualisieren, " +
          "bevor der Zugang pausiert. Aktualisiere sie jederzeit unter Deine Mitgliedschaften auf Bow Down Visuals " +
          "(/memberships) — die neue Karte gibst du auf der sicheren Seite von Stripe ein.\n\n" +
          "Wenn du es schon behoben hast, ignoriere dies einfach — eine erfolgreiche Zahlung beendet diese Erinnerungen.",
        delayHours: 0,
      },
    },
  },
  it: {
    labels: {
      post_purchase: "Ringraziamento post-acquisto",
      abandoned_checkout: "Acquisto abbandonato",
      membership_winback: "Riconquista abbonamento",
      membership_payment_recovery: "Recupero pagamento abbonamento",
    },
    triggerNotes: {
      post_purchase:
        "Si attiva una volta per ogni acquisto completato: una vendita nel tuo negozio (un'e-mail per pagamento, indipendentemente dal numero di articoli) o un download a pagamento. Contano solo le vendite confermate come pagate.",
      abandoned_checkout:
        "Si attiva quando un acquisto inizia ma resta non pagato fino alla chiusura: un acquisto nel tuo negozio che non viene mai pagato, oppure un acquisto nel tuo negozio o sul tuo profilo che scade senza pagamento (un acquisto non pagato si chiude circa un giorno dopo l'inizio). Un'e-mail per acquisto.",
      membership_winback:
        "Si attiva quando l'abbonamento di un fan viene annullato o scade. L'e-mail viene inviata all'indirizzo del suo account, o all'indirizzo che hai registrato per lui.",
      membership_payment_recovery:
        "Si attiva quando il pagamento dell'abbonamento di un fan fallisce e l'abbonamento diventa insoluto: un avviso al momento del fallimento, un promemoria dopo 3 giorni, un avviso di aggiornamento della carta dopo 5 giorni e un avviso finale dopo 6 giorni — un giorno prima che l'accesso si fermi alla fine del periodo di grazia di 7 giorni. La prima e-mail usa l'oggetto e il corpo qui presenti; i passaggi successivi usano testi di recupero fissi, così le date comunicate non cambiano mai.",
    },
    defaults: {
      post_purchase: {
        subject: "Grazie per il tuo acquisto!",
        body:
          "Ciao,\n\nGrazie per aver acquistato nel mio negozio: significa molto e mi aiuta direttamente a continuare a creare.\n\n" +
          "Se qualcosa nel tuo ordine ha bisogno di attenzione, rispondi pure a questa e-mail.\n\nAltro è in arrivo — resta vicino.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "Hai lasciato qualcosa indietro",
        body:
          "Ciao,\n\nHai iniziato un acquisto nel mio negozio ma non l'hai completato: i tuoi articoli ti stanno ancora aspettando.\n\n" +
          "Torna al negozio quando vuoi per completare l'ordine. Nessuna pressione, e grazie per la visita.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "Ci manchi — il tuo abbonamento ti aspetta",
        body:
          "Ciao,\n\nIl tuo abbonamento è terminato di recente e la porta è ancora aperta. Tutto ciò che amavi è ancora qui, " +
          "più tutte le novità da quando te ne sei andato.\n\nTorna quando vuoi — ci piacerebbe riaverti qui.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "Il pagamento del tuo abbonamento non è andato a buon fine",
        body:
          "Ciao,\n\nAbbiamo provato ad addebitare il pagamento del tuo abbonamento e non è andato a buon fine: " +
          "succede con carte scadute, carte sostituite e banche prudenti.\n\n" +
          "Il tuo abbonamento resta attivo per ora. Hai 7 giorni dal pagamento fallito per aggiornare " +
          "la tua carta prima che l'accesso si fermi. Aggiornala quando vuoi da I Tuoi Abbonamenti su Bow Down Visuals " +
          "(/memberships): inserirai la nuova carta nella pagina sicura di Stripe.\n\n" +
          "Se hai già risolto, puoi ignorare questo messaggio: un pagamento riuscito mette fine a questi promemoria.",
        delayHours: 0,
      },
    },
  },
  hi: {
    labels: {
      post_purchase: "खरीद के बाद धन्यवाद",
      abandoned_checkout: "अधूरी खरीदारी",
      membership_winback: "सदस्यता वापसी",
      membership_payment_recovery: "सदस्यता भुगतान वसूली",
    },
    triggerNotes: {
      post_purchase:
        "हर पूरी हुई खरीद पर एक बार चलता है — आपकी दुकान में बिक्री (हर चेकआउट पर एक ईमेल, चाहे कितने भी आइटम हों) या भुगतान वाला डाउनलोड। केवल पुष्टि की गई भुगतान वाली बिक्री ही गिनी जाती है।",
      abandoned_checkout:
        "तब चलता है जब चेकआउट शुरू होता है लेकिन बंद होने तक भुगतान नहीं होता — आपकी दुकान का चेकआउट जिसका भुगतान कभी नहीं होता, या आपकी दुकान या आपकी प्रोफ़ाइल पर कोई चेकआउट जो बिना भुगतान के समाप्त हो जाता है (बिना भुगतान वाला चेकआउट शुरू होने के लगभग एक दिन बाद बंद हो जाता है)। प्रत्येक चेकआउट पर एक ईमेल।",
      membership_winback:
        "तब चलता है जब किसी प्रशंसक की सदस्यता रद्द हो जाती है या समाप्त हो जाती है। ईमेल उनके खाते के पते पर भेजा जाता है, या उस पते पर जो आपने उनके लिए दर्ज किया है।",
      membership_payment_recovery:
        "तब चलता है जब किसी प्रशंसक की सदस्यता का भुगतान विफल हो जाता है और सदस्यता बकाया हो जाती है: विफलता पर एक सूचना, 3 दिन बाद एक अनुस्मारक, 5 दिन बाद कार्ड अपडेट करने का आग्रह, और 6 दिन बाद एक अंतिम चेतावनी — 7-दिन की छूट अवधि के अंत में पहुँच रुकने से एक दिन पहले। पहला ईमेल यहाँ का विषय और मुख्य भाग उपयोग करता है; बाद के चरण निश्चित वसूली शब्दों का उपयोग करते हैं ताकि बताई गई तारीखें कभी न बदलें।",
    },
    defaults: {
      post_purchase: {
        subject: "आपकी खरीद के लिए धन्यवाद!",
        body:
          "नमस्ते,\n\nमेरी दुकान से खरीदारी करने के लिए धन्यवाद — यह मेरे लिए बहुत मायने रखता है, और इससे मुझे सीधे आगे बनाने में मदद मिलती है।\n\n" +
          "अगर आपके ऑर्डर में किसी बात पर ध्यान देने की ज़रूरत हो, तो बस इस ईमेल का जवाब दे दीजिए।\n\nऔर भी बहुत कुछ आ रहा है — जुड़े रहिए।",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "आप कुछ पीछे छोड़ गए",
        body:
          "नमस्ते,\n\nआपने मेरी दुकान में चेकआउट शुरू किया लेकिन पूरा नहीं किया — आपकी पसंद अभी भी आपका इंतज़ार कर रही है।\n\n" +
          "अपना ऑर्डर पूरा करने के लिए किसी भी समय दुकान पर वापस आएँ। कोई दबाव नहीं, और देखने के लिए धन्यवाद।",
        delayHours: 24,
      },
      membership_winback: {
        subject: "हमें आपकी याद आती है — आपकी सदस्यता आपका इंतज़ार कर रही है",
        body:
          "नमस्ते,\n\nआपकी सदस्यता हाल ही में समाप्त हो गई है, और दरवाज़ा अभी भी खुला है। जो कुछ आपको पसंद था वह सब अभी भी यहाँ है, " +
          "साथ में वह सब भी जो आपके जाने के बाद नया आया है।\n\nकिसी भी समय वापस आएँ — हमें आपको फिर से पाकर खुशी होगी।",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "आपकी सदस्यता का भुगतान नहीं हो सका",
        body:
          "नमस्ते,\n\nहमने आपकी सदस्यता का भुगतान लेने की कोशिश की और वह नहीं हो सका — " +
          "ऐसा समाप्त कार्डों, बदले गए कार्डों और सतर्क बैंकों के कारण होता है।\n\n" +
          "आपकी सदस्यता अभी चालू है। विफल भुगतान से 7 दिनों के भीतर अपना कार्ड अपडेट करें, " +
          "इससे पहले कि पहुँच रुक जाए। Bow Down Visuals पर आपकी सदस्यताएँ (/memberships) से किसी भी समय अपडेट करें — " +
          "अपना नया कार्ड आप Stripe के सुरक्षित पेज पर दर्ज करेंगे।\n\n" +
          "अगर आपने पहले ही ठीक कर दिया है, तो इसे अनदेखा करें — सफल भुगतान इन अनुस्मारकों को रोक देता है।",
        delayHours: 0,
      },
    },
  },
  ar: {
    labels: {
      post_purchase: "شكر بعد الشراء",
      abandoned_checkout: "سلة متروكة",
      membership_winback: "استعادة العضوية",
      membership_payment_recovery: "استرداد دفع العضوية",
    },
    triggerNotes: {
      post_purchase:
        "يعمل مرة واحدة لكل عملية شراء مكتملة — عملية بيع في متجرك (بريد واحد لكل عملية دفع، مهما كان عدد المنتجات) أو تنزيل مدفوع. تُحتسب فقط المبيعات المؤكد دفعها.",
      abandoned_checkout:
        "يعمل عندما تبدأ عملية دفع ولا تُدفع حتى تُغلق — عملية دفع في متجرك لا تُدفع أبدًا، أو عملية دفع في متجرك أو على ملفك الشخصي تنتهي دون دفع (تُغلق عملية الدفع غير المدفوعة بعد حوالي يوم من بدئها). بريد واحد لكل عملية دفع.",
      membership_winback:
        "يعمل عندما تُلغى عضوية أحد المعجبين أو تنتهي. يُرسل البريد إلى عنوان حسابه، أو إلى العنوان الذي سجلته له.",
      membership_payment_recovery:
        "يعمل عندما يفشل دفع عضوية أحد المعجبين وتصبح العضوية متأخرة: إشعار عند الفشل، وتذكير بعد 3 أيام، وتنبيه لتحديث البطاقة بعد 5 أيام، وتحذير أخير بعد 6 أيام — قبل يوم واحد من إيقاف الوصول في نهاية فترة السماح البالغة 7 أيام. يستخدم البريد الأول الموضوع والنص هنا؛ وتستخدم الخطوات التالية نصوص استرداد ثابتة حتى لا تتغير التواريخ المُعلنة أبدًا.",
    },
    defaults: {
      post_purchase: {
        subject: "شكرًا على شرائك!",
        body:
          "مرحبًا،\n\nشكرًا لشرائك من متجري — هذا يعني لي الكثير، ويساعدني مباشرة على الاستمرار في الإبداع.\n\n" +
          "إذا احتاج أي شيء في طلبك إلى انتباه، ما عليك سوى الرد على هذا البريد.\n\nالمزيد في الطريق — ابقَ قريبًا.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "لقد تركت شيئًا خلفك",
        body:
          "مرحبًا،\n\nلقد بدأت إتمام عملية شراء في متجري ولم تُكملها — اختياراتك ما زالت في انتظارك.\n\n" +
          "عُد إلى المتجر في أي وقت لإكمال طلبك. دون أي ضغط، وشكرًا لزيارتك.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "نفتقدك — عضويتك في انتظارك",
        body:
          "مرحبًا،\n\nانتهت عضويتك مؤخرًا، والباب ما زال مفتوحًا. كل ما أحببته ما زال هنا، بالإضافة إلى كل ما هو جديد منذ غيابك.\n\n" +
          "عُد في أي وقت — يسعدنا أن تكون معنا مجددًا.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "تعذّر إتمام دفع عضويتك",
        body:
          "مرحبًا،\n\nحاولنا تحصيل دفع عضويتك ولم يتم — " +
          "يحدث هذا مع البطاقات المنتهية والبطاقات المستبدلة والبنوك الحذرة.\n\n" +
          "عضويتك ما زالت فعالة الآن. أمامك 7 أيام من الدفع الفاشل لتحديث " +
          "بطاقتك قبل أن يتوقف الوصول. حدّثها في أي وقت من عضوياتك على Bow Down Visuals " +
          "(/memberships) — ستدخل بطاقتك الجديدة في صفحة Stripe الآمنة.\n\n" +
          "إذا كنت قد أصلحت الأمر بالفعل، يمكنك تجاهل هذا — فالدفع الناجح ينهي هذه التذكيرات.",
        delayHours: 0,
      },
    },
  },
  ja: {
    labels: {
      post_purchase: "購入後のお礼",
      abandoned_checkout: "未完了の購入",
      membership_winback: "メンバーシップ復帰",
      membership_payment_recovery: "メンバーシップ支払い回復",
    },
    triggerNotes: {
      post_purchase:
        "購入が完了するたびに1回作動します。あなたのショップでの販売（アイテム数にかかわらず、会計ごとに1通）または有料ダウンロードが対象です。支払いが確認された販売のみが対象となります。",
      abandoned_checkout:
        "会計が始まったのに、閉じられるまで支払われなかったときに作動します。ショップで支払われなかった会計、またはあなたのストアやプロフィールでの会計が未払いのまま期限切れになった場合です（未払いの会計は開始から約1日で閉じられます）。会計ごとに1通のメールが送られます。",
      membership_winback:
        "ファンのメンバーシップが解約または期限切れになったときに作動します。メールはその方のアカウントのアドレス、またはあなたが記録したアドレスに送信されます。",
      membership_payment_recovery:
        "ファンのメンバーシップ支払いが失敗し、メンバーシップが延滞になったときに作動します。失敗時のお知らせ、3日後のリマインダー、5日後のカード更新のお願い、6日後の最終警告——7日間の猶予期間の終わりにアクセスが停止する1日前です。最初のメールはここの件名と本文を使います。後のステップは固定の回復文面を使うため、伝えられる日付がずれることはありません。",
    },
    defaults: {
      post_purchase: {
        subject: "ご購入ありがとうございます！",
        body:
          "こんにちは。\n\n私のショップでお買い上げいただきありがとうございます。とても嬉しく、創作を続ける大きな支えになります。\n\n" +
          "ご注文について何かありましたら、このメールにご返信ください。\n\n新作も準備中です — どうぞお楽しみに。",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "お買い忘れのアイテムがあります",
        body:
          "こんにちは。\n\n私のショップで会計を始められましたが、完了していません。選ばれたアイテムはまだあなたを待っています。\n\n" +
          "いつでもショップに戻って、ご注文を完了してください。プレッシャーはありません。ご来店ありがとうございました。",
        delayHours: 24,
      },
      membership_winback: {
        subject: "おかえりなさい — メンバーシップが待っています",
        body:
          "こんにちは。\n\nあなたのメンバーシップは最近終了しましたが、扉はまだ開いています。お好きだったものはすべてそのままに、" +
          "あなたが離れている間の新作も加わっています。\n\nいつでも戻ってきてください — またお迎えできるのを楽しみにしています。",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "メンバーシップのお支払いが完了しませんでした",
        body:
          "こんにちは。\n\nメンバーシップのお支払いを試みましたが、完了しませんでした。" +
          "期限切れのカード、再発行されたカード、慎重な銀行などで起こります。\n\n" +
          "メンバーシップは今のところ継続しています。支払い失敗から7日以内にカードを更新してください。" +
          "それを過ぎるとアクセスが停止します。Bow Down Visualsのあなたのメンバーシップ（/memberships）からいつでも更新できます。" +
          "新しいカードはStripeの安全なページで入力します。\n\n" +
          "すでに解決済みの場合は無視してください。支払いが成功すると、これらのお知らせは止まります。",
        delayHours: 0,
      },
    },
  },
  ko: {
    labels: {
      post_purchase: "구매 후 감사",
      abandoned_checkout: "미완료 결제",
      membership_winback: "멤버십 복귀",
      membership_payment_recovery: "멤버십 결제 복구",
    },
    triggerNotes: {
      post_purchase:
        "구매가 완료될 때마다 한 번 작동합니다. 내 상점에서의 판매(아이템 수와 관계없이 결제당 이메일 한 통) 또는 유료 다운로드가 대상입니다. 결제가 확인된 판매만 대상입니다.",
      abandoned_checkout:
        "결제가 시작되었지만 종료될 때까지 결제되지 않았을 때 작동합니다. 상점에서 끝내 결제되지 않은 결제, 또는 내 스토어나 프로필에서 시작된 결제가 미결제 상태로 만료된 경우입니다(미결제 결제는 시작 후 약 하루 뒤에 종료됩니다). 결제당 이메일 한 통.",
      membership_winback:
        "팬의 멤버십이 취소되거나 만료될 때 작동합니다. 이메일은 그 계정의 주소, 또는 내가 그 사람을 위해 기록해 둔 주소로 전송됩니다.",
      membership_payment_recovery:
        "팬의 멤버십 결제가 실패하고 멤버십이 연체될 때 작동합니다. 실패 시 안내, 3일 후 알림, 5일 후 카드 업데이트 안내, 6일 후 마지막 경고 — 7일 유예 기간이 끝나 접근이 중단되기 하루 전입니다. 첫 이메일은 여기의 제목과 본문을 사용하고, 이후 단계는 고정된 복구 문구를 사용하므로 안내되는 날짜가 절대 달라지지 않습니다.",
    },
    defaults: {
      post_purchase: {
        subject: "구매해 주셔서 감사합니다!",
        body:
          "안녕하세요.\n\n제 상점에서 구매해 주셔서 감사합니다. 정말 큰 의미가 있고, 계속 창작하는 데 직접적인 힘이 됩니다.\n\n" +
          "주문에 관해 확인이 필요한 부분이 있으면 이 이메일에 답장해 주세요.\n\n새로운 소식이 계속 찾아갑니다 — 기대해 주세요.",
        delayHours: 2,
      },
      abandoned_checkout: {
        subject: "장바구니에 담아 둔 것이 있어요",
        body:
          "안녕하세요.\n\n제 상점에서 결제를 시작하셨지만 완료하지 않으셨네요 — 고르신 상품이 아직 기다리고 있습니다.\n\n" +
          "언제든 상점으로 돌아와 주문을 완료하세요. 부담 갖지 마시고, 들러 주셔서 감사합니다.",
        delayHours: 24,
      },
      membership_winback: {
        subject: "보고 싶어요 — 멤버십이 기다리고 있습니다",
        body:
          "안녕하세요.\n\n멤버십이 최근에 종료되었지만, 문은 여전히 열려 있습니다. 좋아하셨던 모든 것이 그대로 있고, " +
          "떠나 계신 동안의 새로운 것들도 더해졌습니다.\n\n언제든 돌아오세요 — 다시 함께할 수 있으면 정말 기쁠 거예요.",
        delayHours: 72,
      },
      membership_payment_recovery: {
        subject: "멤버십 결제가 완료되지 않았습니다",
        body:
          "안녕하세요.\n\n멤버십 결제를 시도했지만 완료되지 않았습니다. " +
          "만료된 카드, 재발급된 카드, 신중한 은행 때문에 생기는 일입니다.\n\n" +
          "멤버십은 지금은 계속 유지됩니다. 결제 실패 후 7일 이내에 카드를 업데이트해 주세요. " +
          "그 이후에는 접근이 중단됩니다. Bow Down Visuals의 내 멤버십(/memberships)에서 언제든 업데이트할 수 있으며, " +
          "새 카드는 Stripe의 안전한 페이지에서 입력합니다.\n\n" +
          "이미 해결하셨다면 무시해 주세요. 결제가 성공하면 이 알림은 멈춥니다.",
        delayHours: 0,
      },
    },
  },
};

/** The full copy block for a resolved locale. */
export function automationCopyFor(locale: AutomationLocale): AutomationCopy {
  return AUTOMATION_COPY[locale];
}
