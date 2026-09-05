# 02 — Modèle de données

SQLite + Drizzle ORM. Conventions : tables `snake_case` au singulier, clé primaire `id`
(texte, UUID v7 pour l'ordre chronologique), `cree_le` / `modifie_le` en ISO 8601 UTC.

**Rappels d'unités** — argent en **centimes** (`INTEGER`), masse en **grammes** (`INTEGER`),
volume en **millilitres** (`INTEGER`), pourcentages en **points de base** (10 000 = 100 %).

> **Document révisé le 29/07/2026** pour correspondre à `packages/db/src/schema.ts` (24
> migrations à cette date). La version précédente datait d'avant l'ajout de dix-huit tables et
> d'une trentaine de colonnes ; elle décrivait aussi des colonnes qui n'ont jamais existé sous
> ce nom (voir notes ci-dessous). Source de vérité en cas de nouveau doute : le fichier de
> schéma lui-même, pas ce document.
>
> **Recontrôlé le 30/07/2026.** Quatre migrations de plus ont atterri (`0024` à `0027` :
> `packages/db/drizzle/0024_fat_miss_america.sql` à `0027_needy_tiger_shark.sql`) — **28
> migrations au total** (`0000` à `0027`), et **50 tables** (`grep -c "sqliteTable(" packages/db/src/schema.ts`
> = 50, chiffre qui correspond exactement au nombre d'en-têtes `###` ci-dessous une fois
> recomptés). Les colonnes suivantes, ajoutées le 30/07, manquaient encore dans ce document et
> ont été rajoutées ci-dessous : `ingredient.allergenes_verifies`, `reception.statut`, et cinq
> colonnes sur `session_marche` (`point_depart_texte`, `distance_reelle_km`,
> `cout_deplacement_reel_session_cents`, `cout_deplacement_reel_detour_achats_cents`,
> `cout_deplacement_reel_total_cents`). Trois index ont aussi été ajoutés le même jour
> (`idx_audit_enregistrement` sur `journal_audit`, `idx_session_evenement` sur `session_marche`,
> `idx_nc_lot` sur `non_conformite`) — ce document ne détaille pas les index par principe, ils ne
> sont mentionnés ici que pour mémoire. Aucune vue SQL trouvée (`grep -ri "CREATE VIEW"` sur tout
> le dépôt, hors `node_modules` : zéro résultat) — l'invariant D-020 (« pas de vues SQL ») tient
> toujours à cette date.

---

## Référentiel

### `fournisseur`

`id`, `nom`, `type` (_moulin | grossiste | ferme | detail | systeme_), `email`, `telephone`,
`adresse`, `delai_livraison_jours`, `franco_de_port_cents`, `commande_minimum_cents`, `actif`,
`notes`

> `systeme` n'est pas un fournisseur commercial : c'est la contrepartie interne de l'inventaire
> d'ouverture (D-049). Le moteur de réapprovisionnement l'écarte explicitement, et le formulaire
> de saisie n'accepte que les quatre types commerciaux.

### `ingredient`

`id`, `nom`, `categorie` (_farine | laitier | oeuf | sucre | garniture | consommable | gaz_),
`unite_reference` (_g | ml | piece_), `densite_g_par_ml` (nullable, requis si conversions),
`allergenes` (JSON — sous-ensemble de la liste des 14), **`allergenes_verifies`** (bool, défaut
faux), `stock_securite`, `delai_livraison_jours`, `duree_conservation_jours`, `actif`, `notes`

> **Colonne absente jusqu'au 30/07/2026 : `allergenes_verifies`**
> (`packages/db/src/schema.ts:179`). Distingue « vérifié, aucun allergène » de « jamais évalué » :
> sans ce drapeau, `allergenes = []` s'imprime de façon identique dans les deux cas, et une
> affichette remise au client lirait « aucun allergène » là où c'est en réalité « non vérifié » —
> le seul défaut de cette table qui puisse envoyer quelqu'un à l'hôpital. Tant que ce drapeau est
> faux, un document doit écrire « allergènes non encore vérifiés », jamais une liste vide.
>
> **Pas de `cump_cents_par_unite` sur cette table**, contrairement à une version antérieure de
> ce document. Une valeur dérivée stockée ici contredirait la règle n° 5 de `CLAUDE.md`
> appliquée à la valeur plutôt qu'à la quantité (D-018). Le CUMP se calcule à la lecture, depuis
> les lots, dans `packages/db/src/depots/stock.ts` (`calculerCump`) — jamais stocké.

### `conditionnement`

`id`, `ingredient_id`, `fournisseur_id`, `libelle` (« sac 25 kg »), `quantite_unite_ref`,
`prix_cents`, `reference_fournisseur`, `date_prix`, `actif`

> Invariant : le prix unitaire d'un conditionnement se déduit toujours de
> `prix_cents / quantite_unite_ref`. Ne jamais stocker le prix unitaire séparément.

---

## Recettes et catalogue de vente

### `recette`

`id`, `code` (« R1 »), `nom`, `version` (entier), `recette_parent_id` (version précédente),
`statut` (_brouillon | active | archivee_), `type_pate`, `sans_gluten` (bool),
`rendement_reference_ml`, `rendement_reference_crepes`,
`perte_cuisson_bp`, `taux_casse_bp`, **`perte_fixe_ml`** (D-019 — terme fixe par fournée : fond
de bassine, première crêpe sacrifiée, appliqué en cascade avec `perte_cuisson_bp` et non en
somme), `procede`, `date_activation`, `notes`

> Invariant : une recette `active` est immuable. Toute modification crée une version `version+1`
> et archive la précédente. Les productions référencent une `recette_id` précise, donc une version.

### `recette_ligne`

`id`, `recette_id`, `ingredient_id`, `quantite_unite_ref`, `ordre`, `note_technique`

### `produit_vente`

`id`, `nom` (« Crêpe froment Sirop de Liège »), **`nature`** (_transforme | revendu | **menu**_),
`recette_id` (requis si _transforme_, null sinon), `ingredient_id` (requis si _revendu_ —
l'article acheté-revendu), `prix_cents`, `nb_crepes` (défaut 1 ; **0 est une valeur explicite**
pour un produit `transforme` qui ne produit aucune crêpe, ex. pâte vendue en bouteille — voir
`volume_ml_par_unite` ci-dessous), **`volume_ml_par_unite`** (volume de pâte représenté par une
unité vendue, en ml — pertinent pour la pâte vendue telle quelle, fiche 15 §5.1),
`categorie`, **`consommation_sur_place`** (bool, défaut faux — alimente le seuil SCE/caisse
blanche, distinct de la franchise TVA), `actif`

> `nature = 'menu'` a été ajoutée après la V1 (fiche 16) : un menu est composé d'autres produits
> de vente et n'a ni recette ni stock propres — voir `menu_composition` plus bas. Son coût et sa
> ventilation transformé/revendu se déduisent de ses composants.
>
> Invariant : `nature = 'transforme'` ⟹ `recette_id` non null et `ingredient_id` null.
> `nature = 'revendu'` ⟹ l'inverse. `nature = 'menu'` ⟹ les deux sont null, la composition
> vit dans `menu_composition`. Contrainte portée par Zod, pas par un CHECK SQL.

**Pourquoi cette distinction est structurante.** Un produit transformé consomme un lot de pâte
et des garnitures ; un produit revendu sort directement une unité de stock ; un menu ne consomme
rien en propre. Les trois ont des mécaniques de stock, des taux de marge et des régimes AFSCA
différents. Et à marge égale, la revente génère ~2,6 fois plus de chiffre d'affaires que la
crêpe — or les seuils légaux portent sur le CA (`CLAUDE.md` §6).

### `produit_vente_composant`

`id`, `produit_vente_id`, `ingredient_id`, `quantite_unite_ref` (pour `quantite_reference_unites`
unités vendues), `quantite_reference_unites` (défaut 1 — lot de référence, ex. « pour 100
cafés : 20 g » pour éviter qu'une pincée de 0,2 g s'arrondisse à zéro), `consommation_sur_place`
(nullable — `null` = consommé dans les deux cas), `optionnel` (bool — vrai pour une option
servie sur demande, ex. crème dans un café), `actif`

> **Table absente du document précédent.** C'est la NOMENCLATURE DE VENTE (fiche 15) : ce qu'un
> produit consomme au moment où il est VENDU, par opposition à la recette, consommée à la
> PRODUCTION. Couvre le café à la tasse, les consommables (serviettes, gobelets) et les menus.

### `produit_garniture`

`id`, `produit_vente_id`, `ingredient_id`, `quantite_unite_ref`
→ permet de calculer le coût matière complet d'un produit transformé, garniture comprise.
Non applicable aux produits revendus ni aux menus.

---

## Stock et traçabilité

### `motif`

`id`, `code`, `libelle`, `categorie` (_perte | ajustement | sortie_volontaire | statut_lot_),
`actif`

> **Table absente du document précédent.** Codes structurés pour les mouvements de stock : sans
> eux, le motif restait du texte libre et on ne pouvait pas répondre à « où fuit la matière ? ».
> Le texte libre est conservé en complément sur le mouvement (`motif_texte`), jamais en
> remplacement.

### `lot`

`id`, `ingredient_id`, `fournisseur_id`, `reception_id`, `numero_lot_fournisseur`,
`date_reception`, `date_dlc` (nullable — `null` = non périssable, servi en dernier par la FEFO),
`quantite_initiale`, **`prix_ligne_cents`** (montant réellement payé pour CE lot ; **remplace
`prix_unitaire_cents`**, qui n'existe plus — voir note), **`statut`** (_disponible | quarantaine
| bloque | detruit_), **`motif_statut_id`** (FK `motif`), **`date_changement_statut`**, `notes`

> `prix_unitaire_cents` a disparu. Le taux unitaire est un **quotient dérivé**
> (`prix_ligne_cents / quantite_initiale`) et ne se stocke jamais séparément (règle n° 3 :
> aucun flottant pour de l'argent — un prix par gramme tombe presque toujours sur une fraction
> de centime).
>
> `statut` porte le blocage/déblocage d'un lot suspect (exigence AFSCA), absent du document
> précédent : un ERP bloque et exige un déblocage tracé, il n'autorise pas au fil de l'eau.
>
> La quantité restante d'un lot n'est **jamais** stockée : elle se calcule comme
> `quantite_initiale - SUM(mouvement_stock.quantite WHERE lot_id = ...)`, en TypeScript dans
> `packages/db/src/depots/stock.ts` — **pas** dans une vue SQL (D-020, voir §Agrégats calculés).

### `mouvement_stock`

`id`, `lot_id`, `ingredient_id`, `type` (_entree | sortie_production | sortie_vente | perte |
ajustement_inventaire | consommation_perso_), `quantite` (positive ; le signe est porté par le
type), `date_mouvement`, **`valuation_date`** (date à laquelle la valeur est réputée connue,
distincte de la date du mouvement — une facture arrivée en retard n'oblige plus à modifier une
écriture passée), **`ajustement`** (bool — vrai sur une écriture de correction de coût
postérieure), `production_id` (nullable), `session_id` (nullable), **`motif_id`** (FK `motif`,
**remplace le simple champ `motif`**), `motif_texte` (texte libre, complète le code sans le
remplacer), `cout_cents`, `is_annule`, `annule_par_id`, `cree_par`, `cree_le`

> Invariant central : **le stock est la somme des mouvements**. Aucun écran, aucun service
> ne modifie une quantité de stock autrement qu'en insérant un mouvement.

### `serie_numero`

`id`, `nature` (_reception | commande | production | session | registre…_), `prefixe`, `annee`,
`dernier_numero`, `autorise_trous` (bool, faux par défaut)

> **Table absente du document précédent.** Porte la numérotation séquentielle « sans blancs ni
> lacunes » exigée par la tenue de comptabilité informatisée belge, pour tous les numéros de
> document lisibles (`RC-2026-0001`, `PR-2026-0001`…).

### `reception`

`id`, **`numero`** (« RC-2026-0001 », absent du document précédent), `fournisseur_id`,
`date_reception`, `numero_bon_livraison`, `montant_total_cents`, `fichier_scan_path`,
`commande_id` (nullable), `source` (_manuelle | ia_validee_), **`statut`** (_active | annulee_,
défaut _active_), `notes`

> **Colonne `statut` absente jusqu'au 30/07/2026** (`packages/db/src/schema.ts:532`). Avant son
> ajout, `annulerReception` existait mais ne pouvait détecter une annulation déjà faite
> qu'indirectement, en inspectant le journal d'audit et l'absence de mouvements `entree` non
> annulés — et aucun écran ne pouvait afficher « cette réception est annulée », faute de colonne
> à lire. Même convention que `production.statut`, et non un `is_annule` : pour ne pas
> introduire une seconde convention d'annulation dans le même schéma. L'annulation reste une
> **contrepassation** (règle n° 5) : ce statut résume les mouvements inverses, il ne les
> remplace pas.

---

## Approvisionnement

### `commande_fournisseur`

`id`, **`numero`** (absent du document précédent), `fournisseur_id`, `statut` (_brouillon |
validee | envoyee | recue | annulee_), `date_creation`, `date_envoi`, `date_reception_prevue`,
`montant_total_cents`, `genere_automatiquement` (bool), `email_envoye_a`, **`document_id`**
(remplace `pdf_path`, qui n'existe pas — référence `document_genere`), `notes`

### `commande_ligne`

`id`, `commande_id`, `ingredient_id`, `conditionnement_id`, `quantite_conditionnements`,
`quantite_unite_ref`, **`prix_ligne_cents`** (**remplace `prix_unitaire_cents`**, même raison
que sur `lot` : le montant de la ligne est la donnée stockée, le prix unitaire un quotient dérivé)

### `facture_fournisseur`

`id`, `numero_fournisseur`, `fournisseur_id`, `date_facture`, `date_echeance`,
`montant_total_cents`, `fichier_scan_path`, `statut` (_a_rapprocher | rapprochee | payee |
litige_), `notes`

> **Table absente du document précédent** — désormais alimentée par
> `packages/db/src/services/factures.ts` (fiche 14). Permet le rapprochement à trois
> facture ↔ réception ↔ commande : le prix négocié n'est pas toujours le prix facturé.

### `facture_ligne`

`id`, `facture_id`, `reception_id` (nullable), `ingredient_id` (nullable), `libelle`,
`quantite_unite_ref` (nullable), `montant_cents`, `ecart_prix_cents` (défaut 0 — (prix facturé −
prix commandé) × quantité reçue)

> **Table absente du document précédent.** Lien n↔n : une facture peut couvrir plusieurs
> livraisons.

### `frais_reception`

`id`, `reception_id`, `libelle`, `montant_cents`, `methode_repartition` (_valeur | quantite_,
défaut _valeur_)

> **Table absente du document précédent.** Frais accessoires d'une réception (déplacement pour
> aller chercher la marchandise), répartis sur les lots reçus au lieu d'atterrir hors du coût
> matière.

---

## Production

### `production`

`id`, **`numero`** (absent du document précédent), `recette_id`, `date_production`,
**`statut`** (_lancee | terminee | annulee_, absent du document précédent), `volume_theorique_ml`,
`volume_reel_ml`, `crepes_theoriques`, **`crepes_reelles`** (absent du document précédent),
`numero_lot_pate`, `date_dlc_pate`, `cout_matiere_theorique_cents`, `cout_matiere_reel_cents`,
`session_id` (nullable), `ordre_prevision_id` (nullable), `ecart_motif`, `notes`

### `production_consommation`

`id`, `production_id`, `lot_id`, `ingredient_id`, `quantite_theorique`, `quantite_reelle`
(nullable — rempli par `saisirRealise`, fiche 9), `cout_cents`

---

## Sessions de marché

### `lieu_marche`

`id`, `nom` (« La Batte »), `adresse`, `latitude`, `longitude`, `jour_semaine`, `heure_debut`,
`heure_fin`, `tarif_emplacement_cents`, `mode_tarification` (_metre_lineaire_mois | jour |
forfait_), `metres_lineaires`, **`rayon_recherche_evenements_km`** (défaut 20 — rayon de
recherche d'événements autour de ce lieu, réglable PAR lieu, fiche 05), **`distance_km`**
(distance routière aller simple depuis le point de départ habituel, saisie à la main — une
distance à vol d'oiseau se trompe couramment de 20 à 40 % ; nullable, `null` ≠ zéro km, fiche 13),
**`facturation_electricite`** (_compteur | forfait | comprise | aucune_, nullable = inconnu —
D-055, fiche 17), **`puissance_disponible_w`** (watts disponibles sur l'emplacement, fiche 17),
`actif`, `notes`

> Quatre colonnes absentes du document précédent (`rayon_recherche_evenements_km`,
> `distance_km`, `facturation_electricite`, `puissance_disponible_w`). L'électricité est un
> attribut du **lieu**, jamais une hypothèse globale du projet (D-055, `CLAUDE.md` §6).

### `session_marche`

`id`, `numero`, `lieu_id`, **`evenement_id`** (nullable — événement qui a motivé la session,
fiche 14), `date_session`, `heure_debut_reelle`, `heure_fin_reelle`, `statut` (_planifiee |
en_cours | cloturee | **annulee**_), **`exclure_du_modele`** (bool — exclut la session de
l'estimation du moteur de prévision : panne de gaz, arrivée en retard), **`motif_exclusion`**,
`meteo_prevue` (JSON), `meteo_reelle` (JSON), **`fonds_caisse_initial_cents`** (défaut 0 —
monnaie emportée le matin, hors CA), **`especes_comptees_cents`** (espèces comptées au retour,
fonds initial compris), `ca_carte_cents`, `ca_especes_cents` (**dérivé** :
`especes_comptees − fonds_initial`, jamais saisi), `ecart_caisse_cents`, `ca_total_cents`,
**`ca_transforme_cents`**, **`ca_revendu_cents`** (ventilation pour les seuils légaux),
**`ca_sur_place_cents`** (seuil SCE, distinct de la TVA), `nb_transactions`,
`cout_matiere_cents`, **`commission_carte_cents`** (**renommé** — n'est plus
`commission_sumup_cents`, le paiement par carte n'est pas structurellement lié à SumUp),
`frais_emplacement_cents` (défaut 0), `frais_deplacement_cents` (défaut 0),
**`frais_gaz_cents`** (défaut 0), `frais_divers_cents` (défaut 0),
**`point_depart_texte`** (nullable — `null` = départ du domicile, l'adresse en paramètre ; sinon
point de départ réel de cette session, D-064), **`distance_reelle_km`** (réel, pas entier — c'est
une distance lue sur un compteur, pas un montant ; nullable, `null` = pas encore saisi, **jamais
0** ; à ne pas confondre avec `lieu_marche.distance_km`, qui est une distance de RÉFÉRENCE aller
simple, D-064), **`cout_deplacement_reel_session_cents`** (part portée par la session : ce
qu'elle aurait coûté seule, 2 × la distance de référence du lieu),
**`cout_deplacement_reel_detour_achats_cents`** (part causée par un détour — passage chez un
fournisseur, second marché ; visible mais volontairement **pas** auto-comptabilisée en dépense,
pour ne pas compter deux fois le même plein réel), **`cout_deplacement_reel_total_cents`** (total
réel ; redondant avec la somme des deux parts précédentes seulement quand elles sont connues —
reste calculable même quand la distance de référence du lieu manque et empêche de séparer les
parts), `crepes_produites` (défaut 0),
**`mode_cloture`** (_crepes | volume_, nullable — deux façons de clôturer au choix, D-057),
**`volume_restant_mesure_ml`** (mesure d'origine si `mode_cloture = 'volume'`), `crepes_vendues`
(défaut 0), `crepes_invendues` (défaut 0), `crepes_cassees` (défaut 0), `marge_brute_cents`,
`marge_nette_cents`, `notes_qualitatives`, `date_cloture`

> Nombreuses colonnes absentes du document précédent : `evenement_id`, `exclure_du_modele`,
> `motif_exclusion`, `fonds_caisse_initial_cents`, `especes_comptees_cents`,
> `ca_transforme_cents`, `ca_revendu_cents`, `ca_sur_place_cents`, `frais_gaz_cents`,
> `mode_cloture`, `volume_restant_mesure_ml`, `date_cloture`. Et un renommage :
> `commission_sumup_cents` → `commission_carte_cents`.
>
> **Cinq colonnes de plus, absentes jusqu'au 30/07/2026** (`packages/db/src/schema.ts:963-1027`) :
> `point_depart_texte`, `distance_reelle_km`, `cout_deplacement_reel_session_cents`,
> `cout_deplacement_reel_detour_achats_cents`, `cout_deplacement_reel_total_cents`. Elles portent
> la décision D-064 (« un déplacement est une TOURNÉE, pas un aller-retour » — voir
> `docs/05-DECISIONS.md`) : le porteur a corrigé le modèle initial (aller-retour simple) en séance,
> parce qu'un trajet réel enchaîne domicile → marché → parfois un autre marché → parfois un
> fournisseur → retour. Comme `cout_matiere_theorique_cents`/`cout_matiere_reel_cents` (D-038),
> l'imputation est **figée à la clôture** (D-067) et non recalculée à la lecture, contrairement au
> CUMP : elle décrit un fait passé (des kilomètres déjà roulés pour une session déjà close), pas un
> état courant. `null` partout = pas calculable (distance réelle non saisie), **jamais 0** — un
> zéro ferait croire à une session sans déplacement, donc gratuite en carburant et en usure.
>
> **Point d'attention pour un lecteur futur de ce document** : `docs/05-DECISIONS.md` (D-065,
> 30/07/2026) révise le mode de saisie de `lieu_marche.distance_km` — calcul automatique proposé
> plutôt que saisie manuelle — mais cette révision **n'est pas encore reflétée dans
> `packages/db/src/schema.ts`** au moment où cette note est écrite : la colonne et son commentaire
> décrivent toujours la saisie manuelle (D-064 point 2). Se fier au schéma réel plutôt qu'à cette
> phrase si l'un des deux a bougé depuis.

### `session_vente`

`id`, `session_id`, `produit_vente_id`, `quantite`, `prix_unitaire_cents`, `montant_cents`,
`creneau_horaire` (nullable — analyse « les deux dernières heures paient-elles leur temps ? »,
fiche 13)

### `session_frais`

`id`, `session_id`, `libelle`, `categorie`, `montant_cents`, `justificatif_path`

---

## Documents générés

### `document_genere`

`id`, `type` (_fiche_technique | affichette_allergenes | etiquette_bac | bon_commande |
brief_avant_marche | rapport_session | registre_afsca | export_excel_), `objet_id` (nullable),
`numero` (nullable), `version` (défaut 1), `date_generation`, `chemin`, `taille_octets`,
`hash_sha256` (preuve d'intégrité), `parametres_source` (JSON — instantané des données ayant
servi au rendu), `cree_par`

> **Table absente du document précédent.** Tout document émis est archivé, jamais régénéré
> (D-026) : un registre AFSCA qu'on recalculerait à la demande pourrait différer de celui déjà
> présenté à un contrôle.

---

## Prévision

### `evenement`

`id`, `nom`, `type` (_festival | ferie | sportif | meteo_exceptionnelle | greve | travaux |
concurrence | autre_), `date_debut`, `date_fin`, `portee` (_national | liege | quartier_),
`intensite_estimee` (1–5, défaut 3), `impact_estime_bp` (défaut 10 000), `impact_mesure_bp`
(nullable, rempli après coup), `source`, `valide_par_humain` (bool), **`lieu_id`** (nullable —
FK `lieu_marche`, remplace un encodage informel dans `notes`, fiche 05), **`famille`**
(_grand_public | entreprise | marche_noel_, nullable = événement-facteur classique, fiche 14),
**`effectif_estime`** (nullable — pour une opportunité `entreprise`, prédicteur naturel à la
place de l'historique de fréquentation), **`distance_km`** (à vol d'oiseau, ≠ `lieu_marche.
distance_km` qui est routière), **`commune_texte`**, **`rejete_le`** (nullable — rejet tracé,
jamais un `DELETE`), `notes`

> Six colonnes absentes du document précédent : `lieu_id`, `famille`, `effectif_estime`,
> `distance_km`, `commune_texte`, `rejete_le` (fiches 05 et 14).

### `meteo_observation`

`id`, `lieu_id`, `date_observation`, `type` (_prevision | reelle_), `temperature_c`,
`temperature_ressentie_c`, `precipitations_mm`, `probabilite_pluie_bp`, `vent_kmh`,
`couverture_nuageuse_bp`, `code_meteo`, `donnees_brutes` (JSON), `recupere_le`,
**`horizon_jours`** (nullable — nombre de jours entre récupération et date observée ; l'index
unique porte désormais sur `(lieu, date, type, horizon)` et non plus `(lieu, date, type)` seuls,
sinon une prévision à J-3 écrasait celle de J-7 — D-058)

> Colonne `horizon_jours` absente du document précédent, et l'index unique a changé de forme
> en conséquence (D-058).

### `prevision`

`id`, `session_id` (nullable), `date_calcul`, `version_modele`, `baseline_crepes`,
`facteur_meteo_bp`, `facteur_evenement_bp`, `facteur_saison_bp`, `facteur_tendance_bp`,
**`facteur_comparable_calendaire_bp`** (nullable), **`facteur_jour_semaine_bp`** (nullable),
**`facteur_vacances_scolaires_bp`** (nullable), **`facteur_session_consecutive_bp`** (nullable),
**`inflation_sigma_meteo_bp`** (nullable — inflation de l'écart-type due à l'incertitude
météo, jamais une contraction), `p10_crepes`, `p50_crepes`, `p90_crepes`, `quantile_cible_bp`,
`crepes_recommandees`, **`crepes_retenues`** (après écrêtage par les contraintes dures),
**`contrainte_limitante`** (nullable), **`manque_a_gagner_cents`** (nullable),
`repartition_recettes` (JSON), `confiance_bp`, `nb_sessions_comparables`, `commentaire_ia`
(nullable — jamais un chiffre), `explication_facteurs` (JSON), `crepes_reelles` (nullable,
rempli à la clôture), **`erreur_absolue_bp`** (**remplace `erreur_absolue_pct`**, en points de
base et non en pourcentage)

> Colonnes nullable des facteurs de précision (`facteur_comparable_calendaire_bp`,
> `facteur_jour_semaine_bp`, `facteur_vacances_scolaires_bp`, `facteur_session_consecutive_bp`,
> `inflation_sigma_meteo_bp`, `crepes_retenues`, `contrainte_limitante`,
> `manque_a_gagner_cents`) absentes du document précédent. `NULL` sur ces colonnes signifie
> « ce prédicteur n'existait pas ou n'était pas validé au moment de cette prévision », **pas**
> « neutre » : un prédicteur n'entre en jeu qu'après validation croisée leave-one-out.
>
> **`volume_recommande_ml` (JSON par recette), présent dans une version antérieure de ce
> document, n'existe PAS dans le schéma réel** — colonne à ne plus citer nulle part.
>
> Chaque prévision conserve ses entrées et son résultat. C'est ce qui permet le backtesting :
> sans les entrées, un écart constaté n'apprend rien.

---

## Registre AFSCA

### `releve_temperature`

`id`, `session_id` (nullable), `production_id` (nullable), `equipement`, `temperature_c`,
`date_releve`, `moment` (_depart | arrivee | mi_session | retour | stockage_), `conforme` (bool
— calculé à la saisie contre `temperature_max_froid_c`, puis figé), `action_corrective`,
`releve_par`

### `tache_nettoyage`

`id`, `libelle`, `frequence` (_apres_session | hebdomadaire | mensuelle_), `zone`, `actif`

### `nettoyage_execution`

`id`, `tache_id`, `session_id` (nullable), `date_execution`, `execute_par`, `observations`

### `non_conformite`

`id`, `date_constat`, `type`, `description`, `gravite` (_mineure | majeure | critique_),
`action_corrective`, `date_resolution`, `session_id` (nullable), `lot_id` (nullable)

### `exercice_tracabilite`

`id`, `date_exercice`, `lot_depart_id` (nullable), `duree_minutes` (nullable), `resultat`
(_concluant | ecarts | echec_), `ecarts_constates` (nullable), `document_id` (nullable)

> **Table absente du document précédent.** Trace un exercice de traçabilité (remonter d'une
> vente jusqu'au lot fournisseur) : sans elle, l'application produit le registre mais ne peut
> démontrer qu'un exercice a réellement eu lieu.

---

## Comptabilité

### `depense`

`id`, `date_depense`, `libelle`, `categorie` (_matiere | emplacement | carburant | materiel |
assurance | formation | frais_bancaires | telecom | autre_), `montant_cents`, `fournisseur_id`
(nullable), `justificatif_path`, `deductible_bp` (défaut 10 000), `immobilisation_id`
(nullable), `notes`

### `immobilisation`

`id`, `libelle`, `date_acquisition`, `montant_cents`, `duree_amortissement_annees`, `methode`
(_lineaire | degressive_, défaut _lineaire_), `valeur_residuelle_cents` (défaut 0),
`date_cession` (nullable), `notes`

### `amortissement_annuite`

`id`, `immobilisation_id`, `exercice`, `montant_cents`, `valeur_nette_fin_cents`

### `echeance`

`id`, `libelle`, `recurrence` (_annuelle | trimestrielle | quinquennale | ponctuelle_),
`prochaine_date`, `source_legale`, `url_source` (nullable), `montant_estime_cents` (nullable),
`statut` (_a_venir | faite | en_retard_), `date_realisation` (nullable)

> **Table absente du document précédent.** Le projet ne prévoyait qu'un rappel (listing TVA au
> 31 mars) ; il en manquait au moins quatre : cotisations INASTI trimestrielles, contribution
> AFSCA annuelle, renouvellement de l'autorisation ambulante quinquennal, formulaire e604B.

### `periode`

`id`, `annee`, `mois`, `statut` (_ouverte | cloturee | verrouillee_), `date_cloture` (nullable),
`cloturee_par` (nullable), `date_reouverture` (nullable), `motif_reouverture` (nullable)

> **Table absente du document précédent.** Verrou de période : la clôture MARQUE plutôt qu'elle
> n'interdit (le refus pur crée du contournement). Une réouverture reste possible et se trace.

### `parametre`

`id`, `cle`, `valeur`, `type_valeur`, `date_debut_validite`, `date_fin_validite`, `source`,
`description`

> Le catalogue réel compte **plus de soixante clés** (`packages/core/src/parametres.ts`),
> essentiellement des coefficients du moteur de prévision (`prevision_*` : priors météo par
> catégorie, saison, tendance, comparable calendaire, horizon calendaire, repartition des
> recettes…), en plus des seuils légaux. La liste ci-dessous n'en est plus qu'un sous-ensemble
> illustratif — **ne pas la dupliquer ici** : `packages/core/src/parametres.ts` est la source de
> vérité, chaque clé y porte sa description et sa justification.
>
> Seuils légaux et paramètres structurants : `seuil_franchise_tva_cents`, `seuil_airbag_cents`,
> `seuil_cotisation_reduite_cents`, `seuil_sce_cents`, `seuil_alerte_bp`,
> `taux_cotisation_inasti_bp`, `taux_ipp_marginal_bp`, `taux_commission_sumup_bp`,
> `quantile_cible_production_bp`, `temperature_max_froid_c`, `duree_conservation_pate_heures`,
> `capacite_cuisson_crepes_par_heure`, `cout_kilometrique_cents_par_km`.

---

## Fiche 12 — Suivi des économies d'achat

### `economie_achat`

`id`, `date_action`, `ingredient_id`, `fournisseur_id`, `conditionnement_id` (nullable),
`type_action` (_negociation_prix | achat_alternatif | remplacement_stock_immobilise | autre_),
`description`, `prix_unitaire_avant_cents`, `prix_unitaire_apres_cents`, `quantite_concernee`,
`commande_id` (nullable), `saisi_par` (nullable)

> **Table absente du document précédent** (inspirée d'un classeur Mithra Pharmaceuticals,
> `docs/demandes/12`). **Pas de colonne `economie_cents`, décision délibérée** : elle se
> recalcule toujours depuis `(avant − après) × quantité` dans
> `packages/core/src/economies.ts` (`calculerEconomieCents`), jamais stockée — même principe
> que le CUMP (D-018) et le prix ligne (D-044).

---

## Concurrents

### `concurrent`

`id`, `nom`, `lieu_id`, `type_offre` (_crepes | gaufres | autre_sucre | sale | mixte_),
`positionnement` (_bas_de_gamme | standard | premium_), `emplacement_observe` (nullable),
`qualite_percue` (1–5, subjectif assumé), `date_derniere_observation` (nullable, dérivée),
`notes_generales` (nullable), `actif`

### `concurrent_produit`

`id`, `concurrent_id`, `nom_produit`, `prix_cents`, `description` (nullable),
`date_observation`

> Historisé — une ligne par relevé, jamais un `UPDATE` en place : un même produit peut être
> observé à des prix différents dans le temps. Le dernier prix connu se projette à la LECTURE.

### `concurrent_observation`

`id`, `concurrent_id`, `date_observation`, `affluence_estimee` (_nulle | faible | moyenne |
forte_), `file_attente` (bool), `notes` (nullable)

> Trois tables absentes du document précédent (`docs/demandes/08-FICHES-CONCURRENTS.md`).
> **Limite assumée, écrite aussi à l'écran** : le moteur de prévision ne consomme PAS cette
> donnée en V1. Un concurrent est un facteur de répartition de la clientèle entre vendeurs,
> jamais de la demande totale du marché.

---

## Énergie et équipement

### `equipement`

`id`, `nom`, `type` (_chauffage | eclairage | froid | cuisson | paiement | autre_),
`puissance_w`, `en_service` (bool, défaut faux — peut être déclaré pour comparaison avant achat
sans être en service), `notes` (nullable), `actif`

### `equipement_session`

`id`, `session_id`, `equipement_id`, `duree_minutes`

> Deux tables absentes du document précédent (fiche 17). Le coût se dérive
> (puissance × durée × prix du kWh) mais ne s'applique QUE si le lieu facture au compteur
> (`lieu_marche.facturation_electricite`) : sur beaucoup d'emplacements l'électricité est
> comprise dans le tarif ou facturée au forfait, et calculer des kWh y inventerait un coût
> compté deux fois.

---

## Menus

### `menu_composition`

`id`, `menu_id` (FK `produit_vente`), `produit_inclus_id` (FK `produit_vente`),
`quantite` (défaut 1), `prix_force_cents` (nullable — `null` = répartition au prorata),
`actif`

> **Table absente du document précédent** (fiche 16). La remise d'un menu (crêpe 3,50 € + café
> 2,00 € vendus 5,00 €) doit être répartie entre ses composants, sinon la ventilation
> transformé/revendu — qui alimente les seuils légaux — devient fausse. Deux méthodes de
> répartition coexistent : prorata (sans saisie) ou prix imposé par composant ; quelle que soit
> la méthode, la somme des parts vaut exactement le prix du menu.

---

## Objectifs

### `objectif`

`id`, `grandeur` (_chiffre_affaires | marge_nette | nombre_sessions |
cout_matiere_par_crepe_), `date_debut`, `date_fin`, `valeur_cible` (centimes ou compte entier
selon la grandeur), `notes`

> **Table absente du document précédent** (fiche 18 §4). Une cible que le porteur se fixe, avec
> l'écart mesuré au fil du temps — utile même sans aucun badge de succès. Correction par
> contre-écriture dans `notes` (marqueur `[ANNULATION:<id>]`), pas de colonne `is_annule` : même
> logique que `depense`.

---

## Technique

### `journal_ia`

`id`, `date_appel`, `usage` (_prevision | analyse_ecart | extraction | synthese | evenements_),
`modele`, `tokens_entree`, `tokens_sortie`, `cout_cents`, `prompt_hash`, `reponse_brute`,
`validee_par_humain` (nullable), `duree_ms`, `erreur`

### `journal_audit`

`id`, `table_cible`, `enregistrement_id`, `action` (_creation | modification | annulation_),
`valeurs_avant` (JSON), `valeurs_apres` (JSON), `date_action`, `utilisateur`

> Restreint aux données de référence (recettes, paramètres, ingrédients, produits,
> conditionnements, lieux) — pas le transactionnel, immuable par construction et donc rien à
> journaliser dessus.

### `utilisateur`

`id`, `nom`, `role` (_proprietaire | collaborateur_), `actif`
→ pas d'authentification en V1 (application locale) ; le champ sert à tracer qui a saisi quoi.

---

## Agrégats calculés — pas de vues SQL

**Écart assumé par rapport à une version antérieure de ce document (D-020).** Aucune des
requêtes suivantes n'est une vue SQL (`CREATE VIEW`) : elles sont calculées à la lecture, en
TypeScript, dans les dépôts de `packages/db/src/depots/`. Même résultat, une migration de moins
à maintenir, calcul testable. Le jour où un export SQL direct deviendrait nécessaire, une vue se
crée en une migration à partir de la requête existante.

| Besoin                                                           | Où c'est calculé aujourd'hui                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Quantité restante et valeur d'un lot, stock par ingrédient, CUMP | `packages/db/src/depots/stock.ts`                                                         |
| Coût de revient par recette / par produit vendu                  | `packages/db/src/depots/recettes.ts` (`coutRevientProduit`, `listerCoutsRevientProduits`) |
| Rentabilité d'une session, d'un lieu                             | `packages/db/src/depots/sessions.ts`, `packages/db/src/depots/lieux-rentabilite.ts`       |
| CA glissant, seuils légaux (ventilé transformé/revendu)          | `packages/db/src/depots/sessions.ts` (`tableauSeuils`)                                    |
| Écart théorique/réel de consommation                             | `packages/db/src/services/production.ts` (`saisirRealise`)                                |
| Ventes agrégées par créneau horaire                              | `packages/db/src/depots/comptabilite.ts` (`ventesParCreneauBrutes`)                       |

---

## Invariants à tester explicitement

1. `SUM(mouvements d'un lot) ≤ quantite_initiale` — un lot ne peut pas être surconsommé.
2. Aucun mouvement de sortie ne peut porter sur un lot dont la DLC est dépassée à la date du
   mouvement, sauf motif explicite enregistré.
3. `session.ca_total_cents == SUM(session_vente.montant_cents)` à la clôture.
4. `(especes_comptees - fonds_caisse_initial) + ca_carte - ca_total == ecart_caisse`.

   > **Corrigé le 27/07/2026.** La formulation précédente — `ca_especes + ca_carte - ca_total` —
   > était **fausse dès qu'un fonds de caisse existe**. Partir avec 60 € de monnaie donne
   > `CA espèces + 60` au comptage du soir : l'égalité ne tenait que si l'utilisateur soustrayait
   > le fonds de tête, c'est-à-dire s'il faisait à la main le calcul que l'application doit faire.
   > D'où deux champs distincts sur `session_marche` : `fonds_caisse_initial_cents` et
   > `especes_comptees_cents`. `ca_especes` en est **dérivé**, il ne se saisit pas.

5. Une recette `active` référencée par au moins une production ne peut plus être modifiée.
6. Le CUMP d'un ingrédient est toujours cohérent avec la valorisation de ses lots restants.

   > **Ne tient plus depuis le 01/08/2026, et c'est assumé.** La valorisation du stock **exclut
   > désormais la matière périmée** — un lot dont la DLC est passée ne peut légalement plus être
   > vendu, ce n'est donc pas un actif. `calculerCump`, lui, continue de l'inclure. Les deux chiffres
   > divergent dès qu'un lot périmé subsiste, et l'écart est **mesuré par un test dédié**, pas
   > découvert à l'usage.
   >
   > **Pourquoi on ne « répare » pas l'invariant en alignant le CUMP** : ce sont deux questions
   > différentes. La valorisation répond à « que vaut ce que je peux encore vendre ? » ; le CUMP
   > répond à « à quel prix moyen ai-je payé cette matière ? » — et une matière périmée **a bien été
   > payée**. Aligner le CUMP sur la valorisation ferait disparaître un coût réellement décaissé,
   > ce que le §7 de `CLAUDE.md` interdit.
   >
   > L'invariant était donc **mal formulé dès l'origine** : il postulait que valeur marchande et coût
   > d'acquisition ne peuvent pas diverger. Ils le peuvent, et la différence porte un nom — c'est la
   > perte. À reformuler comme deux invariants distincts plutôt qu'à rétablir.

7. Toute production a au moins une ligne de consommation pour chaque ligne de sa recette.
8. Aucun montant en base n'est un flottant.
9. La somme des parts d'un `menu_composition` (`prix_force_cents` ou prorata) est exactement
   égale au `prix_cents` du menu — sinon la ventilation transformé/revendu est faussée.
