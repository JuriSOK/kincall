# KinCall — Product Specification

> **Because every vulnerable person deserves someone who checks in.**

## 1. Présentation du produit

**KinCall** est un système d’agents téléphoniques autonomes destiné aux personnes âgées, handicapées ou vulnérables vivant seules ou nécessitant un suivi régulier.

KinCall appelle régulièrement la personne afin d’avoir une conversation naturelle avec elle. L’objectif n’est pas de lui faire remplir un questionnaire, mais de créer une interaction familière au cours de laquelle l’agent peut prendre de ses nouvelles et identifier d’éventuelles situations inhabituelles.

Lorsqu’un problème est détecté, un orchestrateur déclenche l’agent téléphonique le plus adapté. Celui-ci peut notamment appeler les proches enregistrés, leur expliquer la situation et trouver une personne capable d’intervenir.

KinCall ne remplace ni la famille, ni les professionnels de santé, ni les services d’urgence. Il aide le cercle de confiance à rester présent et à mieux se coordonner.

---

## 2. Signification du nom

Le mot anglais **kin** désigne la famille, les proches ou les personnes avec lesquelles un individu entretient un lien fort.

Le nom **KinCall** associe donc :

- **Kin** : la famille et le cercle de confiance ;
- **Call** : l’appel téléphonique, qui constitue le principal moyen d’action du produit.

Le nom reflète la promesse centrale du produit :

> **Utiliser les appels téléphoniques pour maintenir le lien entre une personne vulnérable et ses proches.**

---

## 3. Problème identifié

De nombreuses personnes âgées, handicapées ou vulnérables vivent seules ou passent une grande partie de leur journée sans interaction avec leurs proches.

Leurs familles souhaitent prendre régulièrement de leurs nouvelles, mais plusieurs difficultés se présentent :

- les proches ne peuvent pas toujours appeler quotidiennement ;
- les appels sont parfois oubliés ou reportés ;
- la personne vulnérable ne souhaite pas forcément déranger sa famille ;
- elle peut minimiser ses difficultés pour ne pas inquiéter son entourage ;
- elle peut oublier de signaler un événement important ;
- une situation inhabituelle nécessite parfois d’appeler plusieurs personnes avant de trouver quelqu’un de disponible ;
- les SMS, notifications et applications mobiles ne sont pas toujours adaptés au public concerné.

Aujourd’hui, le suivi et la coordination reposent principalement sur la disponibilité des proches.

---

## 4. Vision du produit

KinCall doit devenir une présence téléphonique familière capable de :

1. prendre régulièrement des nouvelles d’une personne vulnérable ;
2. maintenir une conversation naturelle et adaptée à son profil ;
3. identifier les informations importantes au cours de l’échange ;
4. détecter les situations qui nécessitent l’attention du cercle de confiance ;
5. contacter automatiquement les proches dans l’ordre prévu ;
6. expliquer clairement la situation ;
7. confirmer qu’une personne peut intervenir ;
8. enregistrer l’ensemble des actions réalisées.

La vision du produit peut être résumée ainsi :

> **KinCall appelle pour créer du lien et orchestre les proches lorsque quelque chose semble anormal.**

---

## 5. Cibles

### 5.1 Utilisateur principal

La personne qui reçoit les appels de KinCall :

- personne âgée vivant seule ;
- personne en situation de handicap ;
- personne atteinte de troubles cognitifs légers ;
- personne atteinte de la maladie d’Alzheimer, selon un profil conversationnel adapté ;
- personne isolée ;
- personne ayant besoin d’un suivi régulier non médical.

### 5.2 Client principal

La personne qui configure et finance le service :

- enfant ;
- conjoint ;
- frère ou sœur ;
- membre de la famille ;
- aidant ;
- représentant légal.

Pour le MVP du hackathon, la cible commerciale principale est :

> **Un proche souhaitant veiller sur un membre vulnérable de sa famille sans pouvoir l’appeler constamment.**

### 5.3 Cibles secondaires

À plus long terme, KinCall pourrait être utilisé par :

- services d’aide à domicile ;
- résidences autonomie ;
- associations ;
- établissements spécialisés ;
- mutuelles ;
- assureurs ;
- services de téléassistance.

Ces cibles ne font pas partie du périmètre prioritaire du MVP.

---

## 6. Proposition de valeur

### Pour la personne vulnérable

- recevoir régulièrement un appel ;
- pouvoir discuter sans avoir l’impression d’être interrogée ;
- ne pas avoir à prendre elle-même l’initiative de déranger ses proches ;
- bénéficier d’une présence stable et familière ;
- être aidée lorsque quelque chose ne va pas.

### Pour les proches

- être rassurés sans devoir appeler plusieurs fois par jour ;
- être alertés uniquement lorsqu’une situation mérite leur attention ;
- recevoir un résumé clair et contextualisé ;
- éviter de devoir coordonner manuellement toute la famille ;
- savoir qui a répondu et qui peut intervenir.

### Pour le hackathon

KinCall démontre que CALL-E peut être utilisé non seulement pour passer un appel, mais pour orchestrer plusieurs agents téléphoniques spécialisés autour d’un besoin humain concret.

---

## 7. Principes du produit

### 7.1 La conversation avant le questionnaire

KinCall ne doit pas donner l’impression de suivre une liste rigide de questions.

L’agent doit introduire naturellement les éléments importants dans la conversation.

Exemple :

> Bonjour Marie. Comment allez-vous aujourd’hui ? Vous m’aviez parlé de votre jardin la dernière fois. Avez-vous pu vous en occuper cette semaine ?

La personne peut alors répondre naturellement :

> Non, je ne suis pas sortie depuis ma chute.

Cette information peut être identifiée sans que l’appel ressemble à un interrogatoire médical.

### 7.2 Une présence familière

Le même agent doit conserver :

- le même prénom ;
- la même voix ;
- un ton cohérent ;
- une mémoire limitée des conversations précédentes ;
- une connaissance des centres d’intérêt et habitudes autorisés.

L’objectif est de créer une interaction reconnaissable et rassurante.

### 7.3 Des agents spécialisés

Un seul agent ne doit pas tout faire.

Chaque type d’appel possède :

- un objectif différent ;
- un niveau de concision différent ;
- un ton adapté ;
- des informations spécifiques à transmettre ;
- des règles distinctes.

### 7.4 Une orchestration invisible pour l’utilisateur

La personne vulnérable ne doit pas avoir à comprendre l’architecture technique.

Pour elle, KinCall reste une seule présence cohérente.

L’architecture multi-agents est utilisée en arrière-plan pour améliorer la sécurité, la précision et l’efficacité du système.

### 7.5 L’humain reste responsable

KinCall accompagne les proches mais ne remplace pas leur jugement.

Le produit ne doit pas :

- établir un diagnostic ;
- prescrire un traitement ;
- affirmer qu’une personne est en sécurité ;
- se substituer à un professionnel ;
- déclencher sans contrôle des actions critiques non autorisées.

---

## 8. Architecture multi-agents

KinCall repose sur plusieurs agents spécialisés coordonnés par un orchestrateur central.

```text
                    ┌────────────────────┐
                    │  Scheduled Check   │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │  Companion Agent   │
                    │ Conversation CALL-E│
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │ Conversation Report│
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │    Orchestrator    │
                    └─────────┬──────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
    No action needed    Family Agent      Escalation Agent
           │                  │                  │
           ▼                  ▼                  ▼
       Call closed     Contact relatives   Apply configured
                      until one accepts      safety protocol
```

---

## 9. Les agents

### 9.1 Companion Agent

#### Mission

Créer une conversation naturelle avec la personne vulnérable et collecter les informations utiles sans transformer l’appel en questionnaire.

#### Comportement

Le Companion Agent :

- appelle la personne à l’heure prévue ;
- se présente clairement comme un assistant automatisé ;
- utilise une voix et un prénom stables ;
- démarre la conversation à partir d’un sujet familier ;
- se souvient des éléments autorisés des conversations précédentes ;
- laisse la personne parler ;
- reformule si une réponse est ambiguë ;
- pose des questions simples ;
- évite les formulations anxiogènes ;
- adapte son langage au profil enregistré ;
- termine l’appel calmement.

#### Exemples d’adaptation

##### Profil standard

- conversation chaleureuse ;
- questions ouvertes ;
- références aux habitudes précédentes.

##### Personne atteinte de troubles cognitifs

- phrases courtes ;
- une seule question à la fois ;
- absence de formulation culpabilisante ;
- répétitions possibles ;
- pas de question du type « Vous ne vous souvenez pas ? ».

##### Personne avec difficulté d’élocution

- pauses plus longues ;
- absence d’interruption ;
- reformulation pour confirmation ;
- réponses simples acceptées.

#### Responsabilités

Le Companion Agent peut :

- discuter ;
- clarifier une information ;
- extraire les faits importants ;
- produire un compte rendu structuré.

Il ne peut pas :

- décider seul d’une escalade ;
- poser un diagnostic ;
- appeler les proches ;
- appeler les secours ;
- promettre qu’une personne va intervenir.

#### Sortie attendue

```json
{
  "call_status": "completed",
  "conversation_summary": "Marie indique être tombée hier et avoir des difficultés à marcher.",
  "signals": [
    {
      "type": "fall_mentioned",
      "value": true,
      "confidence": 0.96
    },
    {
      "type": "mobility_difficulty",
      "value": true,
      "confidence": 0.91
    }
  ],
  "person_requests_help": false,
  "person_does_not_want_to_disturb_family": true,
  "conversation_change": {
    "shorter_than_usual": false,
    "unusual_confusion": false
  },
  "recommended_attention_level": "high"
}
```

### 9.2 Orchestrator

#### Mission

Analyser le compte rendu du Companion Agent et décider de la prochaine action autorisée.

L’Orchestrator ne passe aucun appel directement.

#### Entrées

- résultat structuré du Companion Agent ;
- profil de la personne ;
- règles configurées par la famille ;
- liste ordonnée des contacts ;
- historique récent ;
- statut des appels précédents ;
- restrictions de sécurité.

#### Décisions possibles

```text
NO_ACTION
LOG_AND_CLOSE
RETRY_CHECK_IN
CONTACT_TRUSTED_PERSON
CONTACT_NEXT_TRUSTED_PERSON
REQUEST_HUMAN_REVIEW
ACTIVATE_CONFIGURED_ESCALATION
```

#### Exemple de logique simplifiée

```text
Si l’appel n’a pas été répondu :
    programmer une nouvelle tentative ;
    si le nombre maximal de tentatives est atteint :
        contacter le premier proche.

Si la personne mentionne une chute sans difficulté actuelle :
    contacter un proche selon les règles configurées.

Si la personne mentionne une chute et ne peut pas se déplacer :
    priorité élevée ;
    contacter immédiatement le premier proche ;
    poursuivre la cascade si aucune prise en charge n’est confirmée.

Si aucun signal inhabituel n’est détecté :
    clôturer l’appel ;
    enregistrer un résumé.
```

#### Sortie attendue

```json
{
  "decision": "CONTACT_TRUSTED_PERSON",
  "priority": "high",
  "reason": "Fall mentioned with mobility difficulty.",
  "selected_agent": "family_agent",
  "selected_contact_id": "contact_julie",
  "next_contact_on_failure": "contact_marc",
  "information_to_share": [
    "fall mentioned",
    "difficulty walking",
    "person did not want to disturb family"
  ]
}
```

### 9.3 Family Agent

#### Mission

Informer efficacement un proche et obtenir une confirmation d’intervention.

Contrairement au Companion Agent, le Family Agent ne cherche pas à mener une longue conversation.

Il doit être :

- direct ;
- factuel ;
- calme ;
- transparent ;
- orienté vers une décision.

#### Exemple d’appel

> Bonjour Julie. Je suis KinCall, l’assistant téléphonique configuré pour prendre régulièrement des nouvelles de votre maman.  
>
> Je viens de terminer un appel avec elle. Elle m’a indiqué être tombée hier et avoir aujourd’hui des difficultés à marcher. Elle ne souhaitait pas vous déranger.  
>
> Pouvez-vous la rappeler ou passer la voir aujourd’hui ?

#### Réponses recherchées

- le proche peut intervenir ;
- le proche ne peut pas intervenir ;
- le proche demande davantage d’informations ;
- le proche souhaite appeler lui-même la personne ;
- le proche demande de contacter le suivant ;
- aucune réponse ;
- numéro occupé ;
- appel refusé.

#### Sortie attendue

```json
{
  "contact_id": "contact_julie",
  "answered": true,
  "situation_understood": true,
  "can_intervene": true,
  "intervention_type": "visit",
  "estimated_time": "18:00",
  "contact_next_person": false,
  "summary": "Julie confirme qu’elle passera voir Marie à 18 h."
}
```

#### Comportement en cas d’échec

```text
Julie ne répond pas
        ↓
Orchestrator reçoit NO_ANSWER
        ↓
Marc est sélectionné
        ↓
Family Agent appelle Marc
        ↓
Marc confirme qu’il peut intervenir
        ↓
La cascade s’arrête
```

### 9.4 Escalation Agent

#### Statut dans le MVP

L’Escalation Agent peut être présenté dans l’architecture, mais son intégration avec des services d’urgence réels ne fait pas partie du MVP principal.

#### Mission

Appliquer une procédure d’escalade explicitement configurée par la famille ou l’organisation responsable.

Il peut, selon le contexte autorisé :

- appeler un aidant professionnel ;
- appeler un service de téléassistance ;
- appeler un responsable désigné ;
- transmettre les informations nécessaires à un opérateur humain ;
- préparer un dossier de situation ;
- demander une validation humaine.

#### Limite critique

KinCall ne doit pas être présenté comme un dispositif garantissant la prise en charge d’une urgence médicale.

Dans le MVP :

- aucun appel réel aux pompiers, au SAMU ou à un hôpital n’est effectué ;
- les scénarios d’urgence sont simulés ou redirigés vers un numéro de test autorisé ;
- une validation humaine est requise avant toute action critique.

---

## 10. Cercle de confiance

Chaque personne vulnérable possède un cercle de confiance ordonné.

Exemple :

```json
[
  {
    "priority": 1,
    "name": "Julie",
    "relationship": "Daughter",
    "phone": "+33XXXXXXXXX"
  },
  {
    "priority": 2,
    "name": "Marc",
    "relationship": "Son",
    "phone": "+33XXXXXXXXX"
  },
  {
    "priority": 3,
    "name": "Nicole",
    "relationship": "Trusted neighbour",
    "phone": "+33XXXXXXXXX"
  }
]
```

L’ordre détermine la cascade d’appels.

L’Orchestrator arrête la cascade dès qu’un contact confirme qu’il prend la situation en charge.

---

## 11. Parcours utilisateur principal

### 11.1 Configuration

Le proche crée le profil de la personne vulnérable.

Il renseigne :

- prénom ;
- numéro de téléphone ;
- langue ;
- horaires préférés ;
- fréquence des appels ;
- besoins d’adaptation ;
- centres d’intérêt autorisés ;
- contacts de confiance ;
- ordre des contacts ;
- règles d’escalade ;
- consentements.

### 11.2 Appel régulier

À l’heure prévue :

1. le Companion Agent appelle ;
2. la personne décroche ;
3. une conversation naturelle commence ;
4. les informations pertinentes sont extraites ;
5. un compte rendu structuré est généré.

### 11.3 Décision

L’Orchestrator analyse le compte rendu.

Il peut :

- clôturer l’événement ;
- programmer un nouvel appel ;
- contacter un proche ;
- lancer une cascade ;
- demander une intervention humaine.

### 11.4 Coordination

Le Family Agent appelle les contacts dans l’ordre défini.

Chaque appel cherche à obtenir une réponse concrète :

> Pouvez-vous intervenir ?

### 11.5 Clôture

L’événement est clôturé lorsqu’une condition est remplie :

- aucun problème n’a été détecté ;
- un proche a confirmé une intervention ;
- un opérateur humain a repris le dossier ;
- la procédure configurée est terminée.

---

## 12. Scénario principal du MVP

### Contexte

Marie a 82 ans et vit seule.

Sa fille Julie a configuré KinCall pour l’appeler chaque matin.

### Déroulement

#### Étape 1 — Appel de la personne

Le Companion Agent appelle Marie.

> Bonjour Marie. Comment allez-vous ce matin ? La dernière fois, vous m’aviez dit que vous souhaitiez vous occuper de votre jardin.

Marie répond :

> Je n’ai pas pu. Je suis tombée hier, mais je ne voulais pas embêter Julie.

Le Companion Agent clarifie calmement :

> Je suis désolé de l’apprendre. Est-ce que vous arrivez à vous déplacer aujourd’hui ?

Marie répond :

> Très difficilement.

#### Étape 2 — Analyse

Le Companion Agent produit un compte rendu :

```json
{
  "fall_mentioned": true,
  "mobility_difficulty": true,
  "does_not_want_to_disturb_family": true,
  "attention_level": "high"
}
```

#### Étape 3 — Orchestration

L’Orchestrator décide de contacter Julie.

#### Étape 4 — Appel du proche

Le Family Agent appelle Julie.

> Bonjour Julie. Je viens de parler avec votre maman. Elle m’a indiqué être tombée hier et avoir des difficultés à se déplacer. Elle ne souhaitait pas vous déranger. Pouvez-vous passer la voir aujourd’hui ?

Julie répond :

> Oui, j’irai vers 18 heures.

#### Étape 5 — Confirmation

Le dashboard affiche :

```text
Marie Dupont
Situation : prise en charge confirmée

Événement détecté :
- chute mentionnée ;
- difficulté à se déplacer.

Actions :
- Julie contactée ;
- visite confirmée à 18 h.
```

---

## 13. Fonctionnalités du MVP

### 13.1 Obligatoires

- création d’un profil de personne vulnérable ;
- création d’un cercle de confiance ;
- configuration de l’ordre des contacts ;
- lancement manuel d’un appel de démonstration ;
- appel CALL-E vers la personne vulnérable ;
- conversation naturelle ;
- résumé de l’appel ;
- extraction d’informations structurées ;
- classification simple de la situation ;
- déclenchement de l’Orchestrator ;
- appel CALL-E vers un proche ;
- récupération de sa réponse ;
- cascade vers le contact suivant en cas d’absence ;
- arrêt de la cascade après confirmation ;
- dashboard affichant le statut du workflow ;
- historique des appels et décisions.

### 13.2 Optionnelles

- planification récurrente ;
- mémoire des conversations ;
- plusieurs profils conversationnels ;
- personnalisation de la voix ;
- choix de la langue ;
- nouvel appel vers la personne pour confirmer qu’un proche arrive ;
- résumé envoyé par email ou SMS ;
- appel d’un aidant professionnel de test.

### 13.3 Hors périmètre du MVP

- diagnostic médical ;
- analyse clinique ;
- appel réel aux services d’urgence ;
- connexion à un dossier médical ;
- gestion de prescriptions ;
- reconnaissance certifiée de pathologies ;
- surveillance continue ;
- détection d’une chute par capteur ;
- localisation en temps réel ;
- facturation ;
- application mobile complète ;
- portail pour EHPAD ;
- intégration à des hôpitaux réels.

---

## 14. Interface du MVP

### 14.1 Page d’accueil

Contenu :

- présentation courte de KinCall ;
- bouton « Add a loved one » ;
- liste des profils existants.

### 14.2 Fiche de la personne

```text
Marie Dupont
82 ans

Status
Needs attention

Next check-in
Tomorrow at 09:00

Trusted circle
1. Julie — Daughter
2. Marc — Son
3. Nicole — Neighbour
```

### 14.3 Vue d’un événement

```text
09:02 — Check-in call started
09:09 — Check-in call completed
09:09 — Fall and mobility difficulty detected
09:10 — Calling Julie
09:11 — No answer
09:12 — Calling Marc
09:13 — Marc answered
09:14 — Visit confirmed at 17:30
09:14 — Case closed
```

### 14.4 Résumé

```text
What happened?
Marie mentioned that she fell yesterday and currently has difficulty walking.

What did KinCall do?
KinCall contacted the trusted circle.

Who is taking care of it?
Marc confirmed that he will visit at 17:30.
```

---

## 15. États d’un événement

```text
SCHEDULED
CALLING_PERSON
PERSON_DID_NOT_ANSWER
CONVERSATION_IN_PROGRESS
ANALYSING_CONVERSATION
NO_ACTION_REQUIRED
ATTENTION_REQUIRED
CALLING_TRUSTED_CONTACT
CONTACT_DID_NOT_ANSWER
CONTACT_DECLINED
CONTACT_CONFIRMED
HUMAN_REVIEW_REQUIRED
CASE_CLOSED
```

---

## 16. Données principales

### VulnerablePerson

```json
{
  "id": "person_marie",
  "first_name": "Marie",
  "phone": "+33XXXXXXXXX",
  "preferred_language": "fr-FR",
  "conversation_profile": "cognitive_friendly",
  "preferred_call_time": "09:00",
  "interests": ["gardening", "family"],
  "consent_status": "confirmed"
}
```

### TrustedContact

```json
{
  "id": "contact_julie",
  "first_name": "Julie",
  "phone": "+33XXXXXXXXX",
  "relationship": "daughter",
  "priority": 1,
  "consent_status": "confirmed"
}
```

### CallEvent

```json
{
  "id": "event_001",
  "person_id": "person_marie",
  "agent_type": "companion",
  "call_id": "calle_123",
  "status": "completed",
  "summary": "Marie mentioned a fall.",
  "structured_result": {},
  "started_at": "2026-08-10T09:02:00",
  "ended_at": "2026-08-10T09:09:00"
}
```

### OrchestrationDecision

```json
{
  "event_id": "event_001",
  "decision": "CONTACT_TRUSTED_PERSON",
  "priority": "high",
  "reason": "Fall and mobility difficulty detected.",
  "selected_contact_id": "contact_julie"
}
```

---

## 17. Règles de sécurité

### 17.1 Consentement

Les personnes appelées doivent avoir accepté :

- de recevoir des appels automatisés ;
- que les conversations soient analysées ;
- que certaines informations soient communiquées aux contacts désignés.

### 17.2 Transparence

KinCall doit toujours se présenter comme un agent automatisé.

Il ne doit pas prétendre être :

- un membre de la famille ;
- un médecin ;
- un infirmier ;
- un service public ;
- un opérateur d’urgence humain.

### 17.3 Données partagées

Le Family Agent ne doit transmettre que les informations nécessaires à la prise en charge.

Il ne doit pas communiquer l’intégralité de la conversation sans autorisation.

### 17.4 Urgences

Pour le hackathon :

- les appels aux services d’urgence sont exclus du scénario réel ;
- les appels sont effectués uniquement vers des numéros de test autorisés ;
- l’Escalation Agent est présenté comme une extension future ;
- aucune promesse médicale n’est faite.

### 17.5 Incertitude

Lorsqu’une information est incertaine, KinCall doit utiliser des formulations prudentes.

Exemple :

> Marie a indiqué avoir des difficultés à marcher.

Et non :

> Marie ne peut plus marcher.

### 17.6 Faux positifs

Le système doit distinguer :

- un fait explicitement déclaré ;
- une interprétation ;
- une variation par rapport aux habitudes ;
- une donnée incertaine.

---

## 18. Indicateurs de succès

Pour le MVP, les indicateurs de démonstration sont :

- appel vers la personne correctement exécuté ;
- conversation terminée ;
- résultat structuré récupéré ;
- situation pertinente correctement identifiée ;
- décision d’orchestration générée ;
- appel vers un proche déclenché ;
- réponse du proche extraite ;
- cascade fonctionnelle en cas d’absence ;
- intervention confirmée ;
- dashboard mis à jour ;
- scénario complet réalisé sans intervention manuelle technique.

### Indicateurs produit futurs

- taux d’appels répondus ;
- taux de situations prises en charge ;
- temps moyen avant confirmation d’un proche ;
- nombre moyen de contacts appelés ;
- taux de faux positifs ;
- taux d’escalades inutiles ;
- satisfaction des proches ;
- satisfaction des personnes appelées ;
- taux de conservation du service.

---

## 19. Différenciation

KinCall se distingue d’un agent vocal classique grâce à quatre éléments.

### 19.1 La conversation adaptative

Le Companion Agent adapte son comportement au profil de la personne.

### 19.2 La mémoire relationnelle

L’agent peut utiliser certains éléments des conversations précédentes pour rendre l’appel plus naturel.

### 19.3 L’architecture multi-agents

Chaque type d’appel est exécuté par un agent spécialisé.

### 19.4 L’orchestration téléphonique

KinCall ne se contente pas de détecter une situation. Il contacte les personnes appropriées jusqu’à obtenir une prise en charge confirmée.

---

## 20. Pourquoi CALL-E est indispensable

Sans CALL-E, KinCall ne peut pas fournir sa proposition de valeur principale.

Le produit repose sur la capacité à :

- appeler une personne qui n’utilise pas nécessairement d’application ;
- mener une conversation vocale ;
- s’adapter aux réponses ;
- collecter des informations ;
- appeler plusieurs contacts ;
- gérer les absences et échecs ;
- obtenir des engagements vocaux ;
- récupérer des transcriptions et résultats structurés.

Le téléphone n’est donc pas une fonctionnalité secondaire.

> **Le téléphone est l’interface principale et le moyen d’action de KinCall.**

---

## 21. Positionnement pour le hackathon

### Phrase courte

> **KinCall is a multi-agent phone care coordinator that checks in on vulnerable people and automatically coordinates their trusted contacts when something seems wrong.**

### Pitch de 30 secondes

> Many vulnerable people live alone and do not always tell their families when something is wrong because they do not want to disturb them. KinCall uses a familiar conversational agent to call them regularly. If an unusual situation is detected, an orchestrator launches a specialised family agent that contacts trusted relatives until someone confirms they can help. KinCall does not replace families. It helps them stay present when it matters most.

### Message principal

> **KinCall does not simply detect that something is wrong. It makes sure that someone takes care of it.**

---

## 22. Démonstration du hackathon

### Durée cible

Moins de trois minutes.

### Scénario

#### 0:00–0:20 — Problème

Présentation de Marie, 82 ans, vivant seule.

Sa fille ne peut pas l’appeler chaque matin.

#### 0:20–1:10 — Companion Agent

KinCall appelle Marie.

Elle mentionne une chute et explique qu’elle ne voulait pas déranger sa fille.

#### 1:10–1:25 — Orchestrator

Le dashboard montre :

```text
Fall mentioned
Mobility difficulty detected
Trusted contact required
```

#### 1:25–2:10 — Family Agent

KinCall appelle Julie.

Premier scénario possible :

- Julie ne répond pas ;
- l’Orchestrator appelle Marc.

Marc répond et confirme qu’il passera à 17 h 30.

#### 2:10–2:40 — Résultat

Le dashboard affiche :

```text
Situation detected
Marc contacted
Visit confirmed at 17:30
Case closed
```

#### 2:40–3:00 — Conclusion

Présentation de l’architecture :

```text
Companion Agent
      ↓
Orchestrator
      ↓
Family Agent
```

Conclusion :

> **One conversation detected the problem. A coordinated sequence of calls made sure someone would help.**

---

## 23. Priorités de développement

### Priorité 1 — Boucle principale

- profil Marie ;
- appel Companion ;
- extraction structurée ;
- décision de l’Orchestrator ;
- appel Family ;
- confirmation ;
- dashboard.

### Priorité 2 — Cascade

- premier proche sans réponse ;
- appel du deuxième proche ;
- arrêt après confirmation.

### Priorité 3 — Personnalisation

- profil conversationnel ;
- mémoire simple ;
- centres d’intérêt ;
- ton adapté.

### Priorité 4 — Présentation

- interface claire ;
- timeline ;
- architecture ;
- vidéo ;
- documentation ;
- contribution GitHub liée au hackathon.

---

## 24. Risques du projet

### Risque technique

La qualité de la conversation peut varier.

**Réponse :**

- limiter le scénario de démonstration ;
- préparer des consignes précises ;
- utiliser des résultats structurés ;
- prévoir un mode de simulation pour les répétitions.

### Risque de surcomplexité

Le produit peut devenir trop large.

**Réponse :**

Le MVP se limite à :

```text
Appeler la personne
        ↓
Détecter une situation
        ↓
Appeler les proches
        ↓
Obtenir une confirmation
```

### Risque médical

Le produit peut être perçu comme un dispositif médical.

**Réponse :**

- absence de diagnostic ;
- absence de recommandation médicale ;
- absence d’appel réel aux secours ;
- positionnement centré sur la communication et la coordination.

### Risque éthique

La personne peut se sentir surveillée.

**Réponse :**

- consentement explicite ;
- transparence ;
- conversation naturelle ;
- données minimales ;
- contrôle par la personne et ses proches.

---

## 25. Non-objectifs

KinCall n’a pas pour objectif de :

- remplacer les conversations familiales ;
- simuler un membre de la famille ;
- surveiller secrètement une personne ;
- remplacer une téléassistance certifiée ;
- remplacer un professionnel de santé ;
- diagnostiquer une maladie ;
- décider seul d’une intervention médicale ;
- appeler automatiquement les secours sans procédure contrôlée.

---

## 26. Résumé final

KinCall est un système multi-agents reposant sur CALL-E.

Son fonctionnement principal est simple :

```text
1. Un Companion Agent appelle une personne vulnérable.

2. Il mène une conversation familière et adaptée.

3. Un Orchestrator analyse le compte rendu.

4. Lorsqu’une situation inhabituelle est détectée,
   un Family Agent appelle les proches.

5. Les contacts sont appelés dans l’ordre prévu
   jusqu’à ce que quelqu’un confirme une intervention.

6. Le résultat est enregistré et affiché dans un dashboard.
```

La valeur de KinCall ne réside pas uniquement dans la détection d’un problème.

Elle réside dans sa capacité à transformer une conversation en action concrète :

> **Quelqu’un a été informé, quelqu’un a répondu et quelqu’un va intervenir.**
