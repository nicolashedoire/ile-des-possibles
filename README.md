<div align="center">
  <img src="public/cover.png" alt="Une île énergétique miniature reliant éolienne, habitations et batterie" width="100%" />
  <br /><br />
  <h1>Île · Un monde à comprendre</h1>
  <p><strong>Comprendre les conséquences d'un choix, heure après heure.</strong></p>
  <p>Un laboratoire interactif et pédagogique autour de la production, de la consommation et du stockage d'énergie.</p>
  <p><a href="https://nicolashedoire.github.io/ile-des-possibles/"><strong>Explorer l'île →</strong></a></p>
</div>

---

## Une journée à explorer

Une journée fictive de 24 heures se charge automatiquement à l'ouverture : aucun fichier à télécharger. Dans une vue unique, lancez la lecture ou sélectionnez une heure directement sur le graphique superposé à l'île. Les courbes de production, de consommation et de réserve utilisent leurs échelles respectives.

- Cliquez sur une installation de la maquette 3D ou sur les commandes accessibles au clavier pour ouvrir ses réglages.
- Modifiez la production ou la consommation d'une heure, ou ajustez les capacités de la batterie pour toute la période. Le modèle recalcule alors les heures suivantes.
- Testez une baisse de production ou une pointe de demande, puis comparez la journée avec une référence enregistrée.
- Vérifiez facultativement les bilans horaires avec Z3 : cette vérification porte sur les règles du modèle, pas sur la réalité ou une stratégie optimale.
- Importez facultativement un autre CSV depuis votre appareil. Vous pouvez exporter et partager une référence de journée par fichier ; il n'y a pas de collaboration en direct.

### Pourquoi ? Et si ?

Ouvrez **Pourquoi ?** pour comprendre le bilan de l'heure sélectionnée. Avec **Et si ?**, choisissez la production ou la consommation et faites glisser un point du graphique ; les flèches haut et bas permettent aussi de le modifier au clavier. L'essai porte sur une heure à la fois, avec la possibilité de modifier les deux courbes à cette heure.

La journée entière est recalculée : les courbes en pointillés montrent la référence, et le résumé compare l'énergie non servie et le début de la première pénurie. Parcourez les autres heures pour observer les conséquences sur la batterie et le reste de la journée, puis choisissez **Appliquer** ou **Annuler**. La référence reste intacte pendant l'essai.

Les données d'exemple sont **fictives**. Elles sont déficitaires à toutes les heures : la réserve s'épuise progressivement. Pour explorer aussi la recharge, choisissez une heure et augmentez la production au-dessus de la consommation ; la batterie absorbera alors le surplus dans les limites de sa capacité et de sa puissance de charge.

La maquette 3D a été générée avec Meshy à partir de l'image de couverture, puis optimisée pour le Web. Les installations peuvent être sélectionnées directement ; les pales sont fixes car le modèle généré est un maillage unique. Les indications de flux restent schématiques : elles ne constituent pas un calcul détaillé de réseau électrique.

## Règles du modèle

Chaque ligne décrit une heure avec production et consommation constantes. Les puissances sont exprimées en MW et les énergies en MWh ; sur une heure, 1 MW correspond à 1 MWh.

Le moteur compare production et demande à chaque pas. En cas de surplus, il charge la batterie dans la limite de sa puissance de charge, de la place disponible et du rendement. En cas de déficit, il utilise la batterie dans la limite de sa puissance de décharge et de son énergie disponible. Il calcule les pertes, le surplus non utilisé et l'énergie non servie, puis transmet la réserve restante à l'heure suivante.

Par défaut, la batterie a une capacité de **120 MWh**, contient **100 MWh** au début, peut charger ou décharger au maximum **20 MW** et applique un rendement de **95 %** à chaque étape de charge et de décharge. Ces paramètres sont modifiables. Un créneau est marqué en pénurie si une partie de la demande n'est pas couverte, même pendant quelques minutes.

> Ce modèle simplifié ne représente pas un réseau réel : pas de prévisions météo, de flux électriques détaillés, d'import depuis le continent ou de prise de décision automatique. Les résultats ne servent pas au dimensionnement d'une installation.

## Format des données

Le [CSV d'exemple](public/energy-example.csv) est chargé par défaut. L'import accepte de 1 à 24 lignes horaires ordonnées, consécutives et sans doublon, de `00:00` à `23:00`, avec les colonnes suivantes :

```csv
heure,production_mw,consommation_mw
00:00,22,32
01:00,21,30
```

Les deux puissances doivent être numériques, positives ou nulles. Le fichier est traité dans le navigateur avec DuckDB-Wasm et ne quitte pas l'appareil.

## Démarrer en local

Prérequis : **Node.js 24** et npm.

```bash
npm install
npm run dev
```

Ouvrez l'adresse indiquée dans le terminal. Pour vérifier les calculs et construire l'application :

```bash
npm test
npm run build
```

## Sous le capot

- **React, TypeScript, Vite, Tailwind CSS et composants shadcn/ui** : interface et interactions.
- **Three.js** : maquette 3D manipulable ; **Pretext, RBush et polygon-clipping** : disposition des annotations autour des éléments visibles.
- **DuckDB-Wasm** : lecture locale et ordonnée des données horaires.
- **Automerge** : référence d'une journée complète, comparaison et partage manuel par fichier.
- **Z3** : vérification facultative des bilans et contraintes de la journée. La première activation demande un rechargement et charge environ 9 Mo ; la journée en cours est conservée.
- Un moteur de simulation horaire séparé de l'interface et couvert par des tests.

Les modèles de langage, l'optimisation de stratégies et la collaboration en direct restent des pistes, pas des fonctionnalités de cette version.
