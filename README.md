# Gutscheine für Home Assistant

> **Hinweis:** Dieses Projekt wurde mit KI (Claude von Anthropic) erstellt und ist für den Privatgebrauch gedacht. Nutzung auf eigene Verantwortung.

Gutscheine und Guthabenkarten direkt in Home Assistant verwalten: mit Restwert, Ablaufdatum, Besitzer und Barcode zum Vorzeigen an der Kasse. Die Daten liegen lokal in Home Assistant (`/config/.storage/gutscheine`) und sind Teil jeder Sicherung.

## Funktionen

- **App in der Seitenleiste** („Gutscheine“): Liste nach Ablauf sortiert, Filter nach Besitzer, Anlegen, Bearbeiten, ganz oder teilweise Einlösen, Verlauf der Einlösungen
- **Barcode (Code 128) oder QR-Code** aus der Gutscheinnummer, groß zum Scannen an der Kasse. Je Gutschein wählbar: automatisch, Barcode, QR-Code oder nur Text
- **Sensoren**
  - `sensor.gutschein_<geschäft>` je offenem Gutschein: Restwert in €, Attribute mit Status, Ablaufdatum, Tagen bis Ablauf, Besitzer, Code, PIN
  - `sensor.gutscheine_gesamtwert`: Summe aller gültigen Gutscheine, dazu Anzahl und nächster Ablauf
  - `sensor.gutscheine_laufen_bald_ab`: Anzahl der Gutscheine, die in den nächsten 30 Tagen ablaufen
- **Scanner:** Beim Eintragen den Code mit der Kamera scannen (live, wenn Home Assistant über HTTPS läuft) oder per Foto. Barcode oder QR-Code wird dabei automatisch erkannt.
- **Ausstelldatum:** Steht kein Ablaufdatum auf dem Gutschein, gilt die gesetzliche Frist von 3 Jahren ab Ende des Ausstellungsjahres (§§ 195, 199 BGB). Die App, die Sensoren und der Kalender rechnen dann mit diesem Datum.
- **Kalender** `calendar.gutscheine_ablauf` mit einem Termin am Ablaufdatum jedes Gutscheins
- **Aktionen** für Automationen und Skripte: `gutscheine.add`, `gutscheine.update`, `gutscheine.redeem`, `gutscheine.remove`, `gutscheine.list`

Abgelaufene Gutscheine bleiben in der Liste und sind rot eingefärbt (oft noch einlösbar), bald ablaufende orange. Vollständig eingelöste stehen unter „Eingelöst“, ihr Sensor wird entfernt.

## Installation über HACS

1. HACS → ⋮ → *Benutzerdefinierte Repositories* → `https://github.com/ngehlich/gutscheine-ha`, Typ *Integration*
2. „Gutscheine“ herunterladen und Home Assistant neu starten
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Gutscheine*

## Beispiele

Gutschein anlegen:

```yaml
action: gutscheine.add
data:
  shop: Media Markt
  value: 30
  expires: "2027-12-24"
  owner: Nils
  code: "5303452585670"
```

Teilweise einlösen:

```yaml
action: gutscheine.redeem
data:
  voucher: sensor.gutschein_media_markt
  amount: 12.50
```

Erinnerung eine Woche vor Ablauf:

```yaml
triggers:
  - trigger: calendar
    event: start
    entity_id: calendar.gutscheine_ablauf
    offset: "-7:0:0:0"
actions:
  - action: notify.notify
    data:
      message: "{{ trigger.calendar_event.summary }} in einer Woche"
```

## Entwicklung

```bash
pip install pytest-homeassistant-custom-component home-assistant-frontend
pytest
```

## Drittsoftware

Der Scanner nutzt [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 2.2.4 (MIT), lokal mitgeliefert unter `custom_components/gutscheine/scanner/`. Es werden keine Daten an externe Dienste geschickt.

## Lizenz

GPL-3.0, siehe [LICENSE](LICENSE).
