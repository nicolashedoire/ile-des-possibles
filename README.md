<div align="center">
  <img src="public/cover.png" alt="Une île énergétique miniature reliant éolienne, habitations et batterie" width="100%" />
  <br /><br />
  <h1>Île · Un monde à comprendre</h1>
  <p><strong>Comprendre un système en jouant avec ses équilibres.</strong></p>
  <p>Un prototype interactif et pédagogique autour de l'énergie, du stockage et des conséquences de nos choix.</p>
  <p><a href="https://nicolashedoire.github.io/ile-des-possibles/"><strong>Découvrir le prototype →</strong></a></p>
</div>

---

## Une idée simple

Sur une île, production, consommation et stockage sont liés. Modifiez un paramètre et observez immédiatement ce que cela change : le déficit ou le surplus, l'autonomie théorique de la batterie et une explication en langage courant.

L'ambition du projet est d'explorer une autre façon d'apprendre : **agir sur un système, comprendre les relations de cause à effet et rendre les hypothèses visibles**.

## À essayer

1. Faites varier la production, la consommation, l'énergie stockée ou la puissance maximale de la batterie.
2. Observez le bilan et l'autonomie se recalculer instantanément.
3. Tournez la maquette 3D et sélectionnez un élément pour en découvrir le rôle. Les flux affichés sont schématiques.
4. Essayez « Tenir une heure » : des propositions calculées peuvent être appliquées au scénario. La vérification Z3 est facultative et nécessite une activation puis un rechargement.
5. Enregistrez une référence pour comparer deux scénarios ou partagez-la manuellement sous forme de fichier.
6. Importez un CSV local contenant `production_mw` et `consommation_mw` pour appliquer les moyennes au modèle.

L'interface est utilisable à la souris et au clavier et s'adapte aux petits écrans. [Pretext](https://github.com/chenglou/pretext) calcule les lignes de l'explication selon la largeur disponible.

### Essayer avec une journée fictive

[Télécharger le CSV d'exemple](public/energy-example.csv) : il contient 24 lignes, une par heure, avec des puissances de production et de consommation inventées en MW. Dans l'application, choisissez **Importer un CSV** et sélectionnez ce fichier.

L'import actuel calcule uniquement les moyennes : **25,5 MW** de production et **42 MW** de consommation. Avec la batterie initiale de **10 MWh** et sa puissance maximale de **20 MW**, le modèle indique un déficit de **16,5 MW** et une autonomie d'environ **36 min 22 s**. Cliquez sur **Calculer les options** pour explorer des modifications qui permettraient de couvrir le déficit pendant une heure.

La colonne `heure` est fournie pour situer les données, mais elle est ignorée pour l'instant. L'application ne rejoue pas la journée : elle ne calcule ni les pics horaires ni l'évolution de la batterie au cours du temps. Ces données fictives ne sont pas des mesures ni des prévisions.

## Le modèle en un exemple

Avec **30 MW** de production, **40 MW** de consommation et **10 MWh** disponibles en batterie, le déficit est de **10 MW**. Si la batterie peut fournir cette puissance, elle le couvre théoriquement pendant **1 heure**.

En passant la consommation à **46 MW**, le déficit atteint **16 MW** et l'autonomie devient **37 min 30 s**.

```text
déficit (MW) = max(consommation − production, 0)
autonomie (h) = énergie disponible en batterie (MWh) / déficit (MW)
```

L'autonomie n'est calculée que s'il existe un déficit et si la puissance maximale de décharge suffit à le couvrir. Une batterie vide donne une autonomie de zéro ; en cas de surplus ou de puissance insuffisante, l'indicateur affiche un tiret.

> Ce modèle pédagogique suppose une production et une consommation constantes, sans pertes. Il ne représente pas les contraintes d'un réseau électrique réel et ne constitue pas un outil de prévision ou de dimensionnement.

## Démarrer en local

Prérequis : **Node.js 24** et npm.

```bash
npm install
npm run dev
```

Ouvrez ensuite l'adresse locale indiquée dans le terminal. Pour vérifier les calculs et construire l'application :

```bash
npm test
npm run build
```

## Sous le capot

- **React, TypeScript et Vite** pour l'application côté navigateur.
- **Tailwind CSS et composants shadcn/ui** pour une interface simple et accessible.
- **Three.js** pour la maquette 3D ; **Pretext**, **RBush** et **polygon-clipping** pour mesurer et positionner des annotations autour des installations visibles.
- **math.js** pour construire des propositions simples ; **Z3**, en option, vérifie leurs contraintes dans le navigateur.
- **DuckDB-Wasm** pour calculer les moyennes d'un fichier CSV local.
- **Automerge** pour enregistrer et partager par fichier un scénario de référence.
- Un modèle de calcul indépendant de l'interface, accompagné de tests.

Le prototype fonctionne sans compte ni serveur de données. L'import CSV et les références restent dans le navigateur jusqu'à un export volontaire. L'activation facultative de Z3 enregistre un service worker pour permettre l'isolation nécessaire à WebAssembly et exige un rechargement ; le scénario en cours est conservé dans le stockage de session. Ce service worker ne stocke pas les données du scénario.

La collaboration en direct, la recherche exhaustive ou l'optimisation économique, ainsi que l'intégration de Tone.js, d'un LLM et de Jev restent des pistes : elles ne sont pas encore implémentées. Les propositions sont des alternatives simples, pas une liste exhaustive de solutions.

## La suite à explorer

La première question est pédagogique : **la manipulation de ce petit monde aide-t-elle réellement à comprendre les liens entre production, consommation et stockage ?** Les retours d'utilisation pourront guider les prochaines expériences : comparaison de stratégies, données externes, scénarios partagés ou nouveaux systèmes à explorer.
