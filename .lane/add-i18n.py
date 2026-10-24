#!/usr/bin/env python3
"""Insert membership_payment_recovery into every locale of
email-automation-i18n.ts, right after each membership_winback entry.
Anchors: labels/triggerNotes entries end at the first '\",\\n' after the
key; defaults entries end at 'delayHours: 72,\\n      },'."""
import pathlib, sys

P = pathlib.Path.home() / "workspace/bdv-wt-dunning/artifacts/api-server/src/lib/email-automation-i18n.ts"
src = P.read_text()

# locale -> (label, note, subject, body_parts[list of string literals joined with +])
DATA = {
 "en": (
  "Membership payment recovery",
  "Fires when a fan's membership payment fails and the membership is past due: a notice at the failure, a reminder after 3 days, a card-update nudge after 5 days, and a final warning after 6 days — one day before access pauses at the end of the 7-day grace. The first email uses the subject and body here; the later steps use fixed recovery wording so the dates fans are told never drift.",
  "Your membership payment didn't go through",
  ["Hi there,\\n\\nWe tried to take the payment for your membership and it didn't go through — ",
   "this happens with expired cards, replaced cards, and banks being careful.\\n\\n",
   "Your membership is still on for now. You have 7 days from the failed payment to update ",
   "your card before access pauses. Update it any time from Your Memberships on Bow Down Visuals ",
   "(/memberships) — you'll enter your new card on Stripe's secure page.\\n\\n",
   "If you already fixed it, you can ignore this — a successful payment ends these reminders."],
 ),
 "es": (
  "Recuperación de pago de membresía",
  "Se activa cuando el pago de la membresía de un fan falla y la membresía queda vencida: un aviso en el momento del fallo, un recordatorio a los 3 días, un aviso para actualizar la tarjeta a los 5 días y una advertencia final a los 6 días, un día antes de que el acceso se pause al final del periodo de gracia de 7 días. El primer correo usa el asunto y el cuerpo de aquí; los pasos siguientes usan textos fijos de recuperación para que las fechas comunicadas nunca cambien.",
  "El pago de tu membresía no se pudo procesar",
  ["Hola,\\n\\nIntentamos cobrar el pago de tu membresía y no se pudo procesar: ",
   "esto pasa con tarjetas vencidas, tarjetas reemplazadas y bancos precavidos.\\n\\n",
   "Tu membresía sigue activa por ahora. Tienes 7 días desde el pago fallido para actualizar ",
   "tu tarjeta antes de que el acceso se pause. Actualízala cuando quieras desde Tus Membresías en Bow Down Visuals ",
   "(/memberships): ingresarás tu nueva tarjeta en la página segura de Stripe.\\n\\n",
   "Si ya lo resolviste, puedes ignorar esto: un pago exitoso detiene estos recordatorios."],
 ),
 "fr": (
  "Récupération de paiement d'abonnement",
  "Se déclenche quand le paiement de l'abonnement d'un fan échoue et que l'abonnement devient impayé : un avis au moment de l'échec, un rappel après 3 jours, un avis de mise à jour de la carte après 5 jours et un dernier avertissement après 6 jours — un jour avant la pause de l'accès à la fin du délai de grâce de 7 jours. Le premier e-mail utilise l'objet et le corps ci-dessus ; les étapes suivantes utilisent des textes de récupération fixes pour que les dates annoncées ne changent jamais.",
  "Le paiement de votre abonnement n'a pas abouti",
  ["Bonjour,\\n\\nNous avons essayé de prélever le paiement de votre abonnement et il n'a pas abouti : ",
   "cela arrive avec des cartes expirées, des cartes remplacées et des banques prudentes.\\n\\n",
   "Votre abonnement reste actif pour l'instant. Vous avez 7 jours à partir du paiement échoué pour mettre à jour ",
   "votre carte avant que l'accès ne soit mis en pause. Mettez-la à jour à tout moment depuis Vos Abonnements sur Bow Down Visuals ",
   "(/memberships) — vous saisirez votre nouvelle carte sur la page sécurisée de Stripe.\\n\\n",
   "Si c'est déjà réglé, ignorez ce message : un paiement réussi met fin à ces rappels."],
 ),
 "pt": (
  "Recuperação de pagamento de assinatura",
  "Dispara quando o pagamento da assinatura de um fã falha e a assinatura fica em atraso: um aviso na falha, um lembrete após 3 dias, um aviso para atualizar o cartão após 5 dias e um aviso final após 6 dias — um dia antes de o acesso pausar no fim do período de carência de 7 dias. O primeiro e-mail usa o assunto e o corpo aqui; as etapas seguintes usam textos fixos de recuperação para que as datas informadas nunca mudem.",
  "O pagamento da sua assinatura não foi concluído",
  ["Olá,\\n\\nTentamos cobrar o pagamento da sua assinatura e ele não foi concluído: ",
   "isso acontece com cartões vencidos, cartões substituídos e bancos cautelosos.\\n\\n",
   "Sua assinatura continua ativa por enquanto. Você tem 7 dias a partir do pagamento falho para atualizar ",
   "seu cartão antes que o acesso pause. Atualize quando quiser em Suas Assinaturas no Bow Down Visuals ",
   "(/memberships) — você digitará o novo cartão na página segura da Stripe.\\n\\n",
   "Se você já resolveu, pode ignorar isto — um pagamento bem-sucedido encerra estes lembretes."],
 ),
 "de": (
  "Zahlungswiederherstellung für Mitgliedschaften",
  "Wird ausgelöst, wenn die Zahlung eines Fans fehlschlägt und die Mitgliedschaft überfällig wird: ein Hinweis beim Fehlschlag, eine Erinnerung nach 3 Tagen, ein Hinweis zur Kartenaktualisierung nach 5 Tagen und eine letzte Warnung nach 6 Tagen — einen Tag bevor der Zugang am Ende der 7-tägigen Schonfrist pausiert. Die erste E-Mail nutzt Betreff und Text von hier; die späteren Schritte nutzen feste Wiederherstellungstexte, damit die genannten Daten nie abweichen.",
  "Die Zahlung deiner Mitgliedschaft ist fehlgeschlagen",
  ["Hallo,\\n\\nWir haben versucht, die Zahlung für deine Mitgliedschaft abzubuchen, und es hat nicht geklappt — ",
   "das passiert bei abgelaufenen Karten, ersetzten Karten und vorsichtigen Banken.\\n\\n",
   "Deine Mitgliedschaft läuft vorerst weiter. Du hast 7 Tage ab der fehlgeschlagenen Zahlung Zeit, deine Karte zu aktualisieren, ",
   "bevor der Zugang pausiert. Aktualisiere sie jederzeit unter Deine Mitgliedschaften auf Bow Down Visuals ",
   "(/memberships) — die neue Karte gibst du auf der sicheren Seite von Stripe ein.\\n\\n",
   "Wenn du es schon behoben hast, ignoriere dies einfach — eine erfolgreiche Zahlung beendet diese Erinnerungen."],
 ),
 "it": (
  "Recupero pagamento abbonamento",
  "Si attiva quando il pagamento dell'abbonamento di un fan fallisce e l'abbonamento diventa insoluto: un avviso al momento del fallimento, un promemoria dopo 3 giorni, un avviso di aggiornamento della carta dopo 5 giorni e un avviso finale dopo 6 giorni — un giorno prima che l'accesso si fermi alla fine del periodo di grazia di 7 giorni. La prima e-mail usa l'oggetto e il corpo qui presenti; i passaggi successivi usano testi di recupero fissi, così le date comunicate non cambiano mai.",
  "Il pagamento del tuo abbonamento non è andato a buon fine",
  ["Ciao,\\n\\nAbbiamo provato ad addebitare il pagamento del tuo abbonamento e non è andato a buon fine: ",
   "succede con carte scadute, carte sostituite e banche prudenti.\\n\\n",
   "Il tuo abbonamento resta attivo per ora. Hai 7 giorni dal pagamento fallito per aggiornare ",
   "la tua carta prima che l'accesso si fermi. Aggiornala quando vuoi da I Tuoi Abbonamenti su Bow Down Visuals ",
   "(/memberships): inserirai la nuova carta nella pagina sicura di Stripe.\\n\\n",
   "Se hai già risolto, puoi ignorare questo messaggio: un pagamento riuscito mette fine a questi promemoria."],
 ),
 "hi": (
  "सदस्यता भुगतान वसूली",
  "तब चलता है जब किसी प्रशंसक की सदस्यता का भुगतान विफल हो जाता है और सदस्यता बकाया हो जाती है: विफलता पर एक सूचना, 3 दिन बाद एक अनुस्मारक, 5 दिन बाद कार्ड अपडेट करने का आग्रह, और 6 दिन बाद एक अंतिम चेतावनी — 7-दिन की छूट अवधि के अंत में पहुँच रुकने से एक दिन पहले। पहला ईमेल यहाँ का विषय और मुख्य भाग उपयोग करता है; बाद के चरण निश्चित वसूली शब्दों का उपयोग करते हैं ताकि बताई गई तारीखें कभी न बदलें।",
  "आपकी सदस्यता का भुगतान नहीं हो सका",
  ["नमस्ते,\\n\\nहमने आपकी सदस्यता का भुगतान लेने की कोशिश की और वह नहीं हो सका — ",
   "ऐसा समाप्त कार्डों, बदले गए कार्डों और सतर्क बैंकों के कारण होता है।\\n\\n",
   "आपकी सदस्यता अभी चालू है। विफल भुगतान से 7 दिनों के भीतर अपना कार्ड अपडेट करें, ",
   "इससे पहले कि पहुँच रुक जाए। Bow Down Visuals पर आपकी सदस्यताएँ (/memberships) से किसी भी समय अपडेट करें — ",
   "अपना नया कार्ड आप Stripe के सुरक्षित पेज पर दर्ज करेंगे।\\n\\n",
   "अगर आपने पहले ही ठीक कर दिया है, तो इसे अनदेखा करें — सफल भुगतान इन अनुस्मारकों को रोक देता है।"],
 ),
 "ar": (
  "استرداد دفع العضوية",
  "يعمل عندما يفشل دفع عضوية أحد المعجبين وتصبح العضوية متأخرة: إشعار عند الفشل، وتذكير بعد 3 أيام، وتنبيه لتحديث البطاقة بعد 5 أيام، وتحذير أخير بعد 6 أيام — قبل يوم واحد من إيقاف الوصول في نهاية فترة السماح البالغة 7 أيام. يستخدم البريد الأول الموضوع والنص هنا؛ وتستخدم الخطوات التالية نصوص استرداد ثابتة حتى لا تتغير التواريخ المُعلنة أبدًا.",
  "تعذّر إتمام دفع عضويتك",
  ["مرحبًا،\\n\\nحاولنا تحصيل دفع عضويتك ولم يتم — ",
   "يحدث هذا مع البطاقات المنتهية والبطاقات المستبدلة والبنوك الحذرة.\\n\\n",
   "عضويتك ما زالت فعالة الآن. أمامك 7 أيام من الدفع الفاشل لتحديث ",
   "بطاقتك قبل أن يتوقف الوصول. حدّثها في أي وقت من عضوياتك على Bow Down Visuals ",
   "(/memberships) — ستدخل بطاقتك الجديدة في صفحة Stripe الآمنة.\\n\\n",
   "إذا كنت قد أصلحت الأمر بالفعل، يمكنك تجاهل هذا — فالدفع الناجح ينهي هذه التذكيرات."],
 ),
 "ja": (
  "メンバーシップ支払い回復",
  "ファンのメンバーシップ支払いが失敗し、メンバーシップが延滞になったときに作動します。失敗時のお知らせ、3日後のリマインダー、5日後のカード更新のお願い、6日後の最終警告——7日間の猶予期間の終わりにアクセスが停止する1日前です。最初のメールはここの件名と本文を使います。後のステップは固定の回復文面を使うため、伝えられる日付がずれることはありません。",
  "メンバーシップのお支払いが完了しませんでした",
  ["こんにちは。\\n\\nメンバーシップのお支払いを試みましたが、完了しませんでした。",
   "期限切れのカード、再発行されたカード、慎重な銀行などで起こります。\\n\\n",
   "メンバーシップは今のところ継続しています。支払い失敗から7日以内にカードを更新してください。",
   "それを過ぎるとアクセスが停止します。Bow Down Visualsのあなたのメンバーシップ（/memberships）からいつでも更新できます。",
   "新しいカードはStripeの安全なページで入力します。\\n\\n",
   "すでに解決済みの場合は無視してください。支払いが成功すると、これらのお知らせは止まります。"],
 ),
 "ko": (
  "멤버십 결제 복구",
  "팬의 멤버십 결제가 실패하고 멤버십이 연체될 때 작동합니다. 실패 시 안내, 3일 후 알림, 5일 후 카드 업데이트 안내, 6일 후 마지막 경고 — 7일 유예 기간이 끝나 접근이 중단되기 하루 전입니다. 첫 이메일은 여기의 제목과 본문을 사용하고, 이후 단계는 고정된 복구 문구를 사용하므로 안내되는 날짜가 절대 달라지지 않습니다.",
  "멤버십 결제가 완료되지 않았습니다",
  ["안녕하세요.\\n\\n멤버십 결제를 시도했지만 완료되지 않았습니다. ",
   "만료된 카드, 재발급된 카드, 신중한 은행 때문에 생기는 일입니다.\\n\\n",
   "멤버십은 지금은 계속 유지됩니다. 결제 실패 후 7일 이내에 카드를 업데이트해 주세요. ",
   "그 이후에는 접근이 중단됩니다. Bow Down Visuals의 내 멤버십(/memberships)에서 언제든 업데이트할 수 있으며, ",
   "새 카드는 Stripe의 안전한 페이지에서 입력합니다.\\n\\n",
   "이미 해결하셨다면 무시해 주세요. 결제가 성공하면 이 알림은 멈춥니다."],
 ),
}

ORDER = ["en","es","fr","pt","de","it","hi","ar","ja","ko"]

def esc(s): return s.replace("\\","\\\\").replace('"','\\"')

for loc in ORDER:
    label, note, subject, parts = DATA[loc]
    # find locale block start: "\n  <loc>: {\n    labels: {"
    start = src.index(f"\n  {loc}: {{")
    end = src.index("\n  ", start+4) if False else None
    # block ends at the next locale start or at "\n};" — compute search bound
    bounds = [src.index(f"\n  {o}: {{", start+4) for o in ORDER if src.find(f"\n  {o}: {{", start+4) > start]
    blk_end = min(bounds) if bounds else src.index("\n};", start)
    block = src[start:blk_end]

    def esc_body(s): return s.replace('"','\\"')  # parts carry literal \n for TS

    def insert_after(block, section, anchor_end_pred, new_text):
        sec = block.index(section)
        idx = block.index("membership_winback", sec)
        tail = block[idx:]
        pos = anchor_end_pred(tail)
        return block[:idx+pos] + new_text + block[idx+pos:]

    # labels: first '",\n' after key
    block = insert_after(block, "labels: {", lambda t: t.index('",\n')+3,
        f'      membership_payment_recovery: "{esc(label)}",\n')
    # triggerNotes
    block = insert_after(block, "triggerNotes: {", lambda t: t.index('",\n')+3,
        f'      membership_payment_recovery:\n        "{esc(note)}",\n')
    # defaults: ends at 'delayHours: 72,\n      },'
    body_src = " +\n          ".join(f'"{esc_body(p)}"' for p in parts)
    block = insert_after(block, "defaults: {", lambda t: t.index('delayHours: 72,\n      },')+len('delayHours: 72,\n      },')+1,
        f'      membership_payment_recovery: {{\n        subject: "{esc(subject)}",\n        body:\n          {body_src},\n        delayHours: 0,\n      }},\n')
    src = src[:start] + block + src[blk_end:]

P.write_text(src)
print("done")
