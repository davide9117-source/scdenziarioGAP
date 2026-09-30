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
4. In alto, nel menu a tendina delle funzioni, scegli **`setup`** e premi **Esegui**. Alla prima esecuzione Google chiede l'autorizzazione: *Rivedi autorizzazioni → scegli l'account → Avanzate → Vai a … (non sicuro) → Consenti*. È normale: lo script è tuo e gira sul tuo account.
5. Torna al foglio: trovi le schede `Compiti`, `Turni`, `Eventi`, `Note`, `Clienti`, `Letture`, `Team`, `Utenti`, `Impostazioni`. Nella scheda **Impostazioni** c'è il **codice squadra** (puoi cambiarlo quando vuoi).
6. Di nuovo in Apps Script: **Distribuisci → Nuova distribuzione**. Tipo: **App web**. Descrizione a piacere. *Esegui come:* **Me**. *Chi ha accesso:* **Chiunque**. Premi **Distribuisci** e copia l'**URL dell'app web** (finisce con `/exec`).

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
- **Turni**, **Calendario** (promo con obiettivi e andamento giornaliero, eventi, festività aggiunte in automatico), **Note**, e sotto *Altro*: **Storico**, **Clienti**, **Letture**, **Impostazioni**.
- In **Impostazioni**: cambio password, uscita, gestione team, backup (scarica/ripristina JSON), pulizia automatica delle voci vecchie.

## Il foglio, a mano

Ogni riga è una voce, ogni colonna un campo (`id`, `text`, `due`, …). Si può correggere una cella o cancellare una riga direttamente nel foglio: l'app se ne accorge al prossimo aggiornamento. Non cambiare i nomi delle schede né la riga d'intestazione. Le date sono nel formato `AAAA-MM-GG`, gli orari `HH:MM`.

**Password dimenticata:** nella scheda `Utenti` metti `TRUE` nella colonna `cambioObbligatorio` della persona: potrà rientrare con il codice squadra e scegliere una nuova password.

## Aggiornare lo script

Se `apps-script/Code.gs` cambia: incolla la nuova versione in Apps Script, salva, poi **Distribuisci → Gestisci distribuzioni → ✎ (modifica) → Versione: Nuova versione → Distribuisci**. L'URL resta lo stesso.

## Sviluppo

Solo file statici: `index.html` (interfaccia), `backend.js` (accesso, sincronizzazione, cache offline), `sw.js` (service worker), `manifest.webmanifest`, `icons/`. Per provarla in locale basta un server statico (es. `npx http-server .`); senza HTTPS il service worker non viene registrato ma il resto funziona.

## Limiti

- Non è "in tempo reale": le modifiche dei colleghi compaiono entro ~30 secondi.
- Le funzioni "Da email" e "foto dei turni" della versione originale (usavano l'AI di claude.ai) non sono disponibili in questa versione.
- Apps Script gratuito regge senza problemi un team di poche persone; sopra qualche migliaio di voci il foglio inizia a rallentare (la pulizia automatica in Impostazioni serve a questo).
