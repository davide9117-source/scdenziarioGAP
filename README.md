# Libreria · Team

App per il team di una libreria: compiti e scadenze, turni, calendario promo ed eventi, note di negozio, ordini clienti, letture consigliate.

È una **PWA** (si installa sul telefono dal browser, funziona anche offline) e usa un **foglio Google** come base dati: gratis, condiviso con i colleghi, e i dati si possono leggere e correggere anche direttamente nel foglio.

## Come funziona

```
telefono/PC  ──(app web, GitHub Pages)──►  index.html + backend.js
                                              │  chiamate JSON
                                              ▼
                              Apps Script (apps-script/Code.gs)
                                              │
                                              ▼
                                    foglio Google (una scheda per sezione)
```

- Ogni collega entra con **nome + password**. La prima volta usa il **codice squadra** (nel foglio, scheda `Impostazioni`) e deve subito scegliere una password personale.
- L'app tiene una copia dei dati sul dispositivo: si apre anche senza rete e invia le modifiche appena torna la connessione. Le novità dei colleghi arrivano ogni 30 secondi circa.

## Installazione (una volta sola, ~10 minuti)

### 1. Il foglio Google

1. Apri [sheets.google.com](https://sheets.google.com) con l'account che farà da "proprietario" e crea un foglio nuovo (va bene anche uno già creato: lo script aggiunge le schede che mancano e non tocca il resto).
2. Menu **Estensioni → Apps Script**.
3. Cancella il contenuto di `Codice.gs`, incolla tutto il contenuto di [`apps-script/Code.gs`](apps-script/Code.gs) e salva (icona del dischetto).
4. Clicca l'ingranaggio **Impostazioni progetto** e spunta **"Mostra il file manifest appsscript.json nell'editor"**. Torna all'editor, apri `appsscript.json`, cancella tutto, incolla il contenuto di [`apps-script/appsscript.json`](apps-script/appsscript.json) e salva.
5. Apri [script.google.com/home/usersettings](https://script.google.com/home/usersettings) e metti **API Google Apps Script** su **Attiva** (serve perché lo script possa aggiornarsi da solo).
6. In alto, nel menu a tendina delle funzioni, scegli **`setup`** e premi **Esegui**. Alla prima esecuzione Google chiede l'autorizzazione: *Rivedi autorizzazioni → scegli l'account → Avanzate → Vai a … (non sicuro) → Consenti*. È normale: lo script è tuo e gira sul tuo account.
7. Torna al foglio: trovi le schede `Compiti`, `Turni`, `Eventi`, `Note`, `Clienti`, `Letture`, `Team`, `Utenti`, `Impostazioni`. Nella scheda **Impostazioni** c'è il **codice squadra** (puoi cambiarlo quando vuoi).
8. Di nuovo in Apps Script: **Distribuisci → Nuova distribuzione**. Tipo: **App web**. Descrizione a piacere. *Esegui come:* **Me**. *Chi ha accesso:* **Chiunque**. Premi **Distribuisci** e copia l'**URL dell'app web** (finisce con `/exec`).

> "Chi ha accesso: Chiunque" serve perché l'app la usano persone senza account Google. La protezione è la password di ogni collega: senza, lo script non restituisce né accetta nulla.

### 2. L'app

1. Apri `config.js` in questo repository e incolla l'URL copiato:
   ```js
   window.APP_CONFIG = { apiUrl: 'https://script.google.com/macros/s/…/exec' };
   ```
   (Se lo lasci vuoto, l'app chiede l'indirizzo al primo avvio su ogni dispositivo.)
2. Pubblica l'app con **GitHub Pages**: nel repository *Settings → Pages → Source: Deploy from a branch → Branch: `main`, cartella `/ (root)` → Save*. Dopo un minuto l'app è su `https://<utente>.github.io/<repository>/`.

### 3. Sul telefono di ogni collega

1. Apri il link dell'app nel browser (Safari su iPhone, Chrome su Android).
2. **iPhone:** Condividi → *Aggiungi alla schermata Home*. **Android:** menu ⋮ → *Installa app* (o *Aggiungi a schermata Home*).
3. Apri l'app, scrivi il tuo nome e come password il **codice squadra**; poi scegli la tua password personale.

## Uso quotidiano

- **Oggi**: compiti del giorno, chi è in turno, promo in corso, ritardi, novità dei colleghi.
- **Compiti**: ricorrenti (ogni giorno, giorni fissi della settimana, ogni mese, "il secondo martedì"…) o con scadenza / periodo; spunta con nome di chi l'ha fatto.
- **Turni**, **Calendario** (promo ed eventi con obiettivi e andamento giornaliero, festività aggiunte in automatico) e **Know How** (il manuale di lavoro).
- Barra in basso: **Oggi · Compiti · Turni · Calendario · Know How**. Il menu ☰ in alto apre tutte le sezioni: anche **Note**, **Clienti**, **Letture**, **Storico**, **Impostazioni**.
- In **Impostazioni**: avatar, password, colori (le stesse palette del Know How), team, Know How, backup, pulizia automatica delle voci vecchie.

## Know How (manuale di lavoro)

Il manuale è un file HTML preparato da Elisa con Claude. **Non sta su GitHub** (che è pubblico, e il manuale contiene contatti e procedure interne): è salvato nel foglio Google, in una scheda nascosta `_manuale`, e l'app lo scarica solo dopo l'accesso con nome e password.

**Pubblicare una nuova versione** (solo chi ha il permesso 📘 *Pubblica il Know How*): Impostazioni → Know How → trascina il file `.html` scaricato da Claude, oppure tocca per sfogliare. Prima di pubblicare l'app:
- prova ad aprire il file e lo rifiuta se si blocca o resta vuoto;
- controlla che `DATA_VERSION` sia cambiata (altrimenti chi ha già aperto il manuale non vedrebbe le novità);
- mostra cosa contiene (aree, schede, glossario, contatti, quiz) e chiede conferma.

Restano le ultime **3 versioni**: da *Vedi le versioni* si può tornare a una precedente. Nell'app il tasto "Modifica contenuti" del manuale è nascosto: le modifiche passano dal file di Elisa. Colori: la palette scelta nel Know How o nelle Impostazioni dell'app vale per entrambi.

Per Elisa, quando lavora con Claude: il file deve restare **un'unica pagina HTML** che funziona da sola, e a ogni modifica dei contenuti va aumentato `DATA_VERSION`.

## Compiti da email (IA Gemini)

Chi ha il permesso trova in **Compiti** il pulsante **✉️ Da email**: incolla il testo di una mail (o allega uno screenshot), l'IA propone i compiti con date e note, e lei li controlla prima di crearli.

Per attivarla: Impostazioni → **Amministrazione** → **Gemini** → *Inserisci chiave* (la chiave si crea gratis su [aistudio.google.com/apikey](https://aistudio.google.com/apikey), con l'account `libreriateam`), poi *Prova il collegamento*. Chi può usare la funzione si sceglie nella stessa sezione, con il permesso **✉️ Compiti da email**.

La chiave resta nel foglio (scheda Impostazioni): non arriva mai sui telefoni né su GitHub. Il modello (Flash, Flash Lite, Pro) si sceglie dalla stessa sezione.

## Amministrazione (dall'app)

Chi ha il permesso **amministrazione** trova in Impostazioni la sezione **Amministrazione**, da cui gestisce senza aprire il foglio:
- il **codice squadra** (vederlo, copiarlo, cambiarlo);
- i **permessi** di ogni persona: ✉️ Compiti da email, 📘 Pubblica il Know How, ⚙️ Amministrazione (deve sempre restarne almeno una);
- **Azzera password**: la persona esce da tutti i dispositivi e rientra con il codice squadra;
- **Gemini**: chiave, modello, prova del collegamento.

Il primo permesso di amministrazione si dà una volta sola dal foglio: scheda **Utenti**, colonna **permessi**, scrivi `admin` nella riga della persona (più permessi separati da uno spazio, es. `admin email manuale`). Da lì in poi si fa tutto dall'app.

## Il foglio, a mano

Ogni riga è una voce, ogni colonna un campo (`id`, `text`, `due`, …). Si può correggere una cella o cancellare una riga direttamente nel foglio: l'app se ne accorge al prossimo aggiornamento. Non cambiare i nomi delle schede né la riga d'intestazione. Le date sono nel formato `AAAA-MM-GG`, gli orari `HH:MM`.

**Password dimenticata:** da Impostazioni → Amministrazione → *Azzera password*. In alternativa, nel foglio: scheda `Utenti`, `TRUE` nella colonna `cambioObbligatorio`.

## Aggiornare lo script

**Da dentro l'app, senza aprire Google:** Impostazioni → Amministrazione → **Script del foglio Google** → *Aggiorna lo script*. Lo script scarica da GitHub la versione nuova di `Code.gs`, la installa, crea una nuova versione e la assegna alla distribuzione dell'app: l'indirizzo `/exec` resta lo stesso. Quando c'è un aggiornamento, chi amministra lo vede anche in **Oggi**.

Perché funzioni, lo script installato deve essere quello di novembre 2026 o successivo, con `appsscript.json` del repository e l'API Apps Script attiva (passi 3–5 dell'installazione).

**A mano (solo se l'aggiornamento dall'app non riesce):** incolla la nuova versione di `Code.gs` in Apps Script, salva, poi **Distribuisci → Gestisci distribuzioni → ✎ (modifica) → Versione: Nuova versione → Distribuisci**. L'URL resta lo stesso.

## Sviluppo

Quando cambia `apps-script/Code.gs`, aumentare `SCRIPT_VERSION` nello script e `NEED_SCRIPT` in `index.html` (stesso valore): così chi amministra vede l'aggiornamento da installare.

Solo file statici: `index.html` (interfaccia; lo stile e i colori ricalcano quelli del Know How), `backend.js` (accesso, sincronizzazione, cache offline, scaricamento del Know How), `sw.js` (service worker), `manifest.webmanifest`, `icons/`. Per provarla in locale basta un server statico (es. `npx http-server .`); senza HTTPS il service worker non viene registrato ma il resto funziona.

## Limiti

- Non è "in tempo reale": le modifiche dei colleghi compaiono entro ~30 secondi.
- Apps Script gratuito regge senza problemi un team di poche persone; sopra qualche migliaio di voci il foglio inizia a rallentare (la pulizia automatica in Impostazioni serve a questo).
