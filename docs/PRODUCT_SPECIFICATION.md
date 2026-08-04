# KinCall — Product Specification

> **Because every vulnerable person deserves someone who checks in.**

## 1. Product overview

**KinCall** is an autonomous telephone-agent system for older, disabled, or vulnerable people who live alone or need regular check-ins.

KinCall calls the person regularly to have a natural conversation with them. The goal is not to make them fill out a questionnaire, but to create a familiar interaction during which the agent can check in on them and identify any unusual situations.

When a problem is detected, an orchestrator triggers the most appropriate telephone agent. This agent can, among other things, call the registered relatives, explain the situation to them, and find someone able to help.

KinCall replaces neither the family, nor healthcare professionals, nor emergency services. It helps the trusted circle stay present and coordinate better.

---

## 2. Meaning of the name

The English word **kin** refers to family, relatives, or people with whom an individual has a strong bond.

The name **KinCall** therefore combines:

- **Kin**: family and the trusted circle;
- **Call**: the phone call, which is the product's main means of action.

The name reflects the product's central promise:

> **Use phone calls to maintain the connection between a vulnerable person and their loved ones.**

---

## 3. Problem identified

Many older, disabled, or vulnerable people live alone or spend much of their day without interacting with their loved ones.

Their families want to check in on them regularly, but several difficulties arise:

- relatives cannot always call every day;
- calls are sometimes forgotten or postponed;
- the vulnerable person does not necessarily want to bother their family;
- they may downplay their difficulties so as not to worry those around them;
- they may forget to report an important event;
- an unusual situation sometimes requires calling several people before finding someone available;
- text messages, notifications, and mobile apps are not always suited to this audience.

Today, follow-up and coordination rely mainly on the availability of relatives.

---

## 4. Product vision

KinCall should become a familiar telephone presence capable of:

1. regularly checking in on a vulnerable person;
2. holding a natural conversation suited to their profile;
3. identifying important information during the exchange;
4. detecting situations that require the trusted circle's attention;
5. automatically contacting relatives in the planned order;
6. clearly explaining the situation;
7. confirming that someone can help;
8. recording every action taken.

The product vision can be summarized as follows:

> **KinCall calls to create connection, and orchestrates relatives when something seems wrong.**

---

## 5. Targets

### 5.1 Primary user

The person who receives KinCall's calls:

- an older person living alone;
- a person with a disability;
- a person with mild cognitive impairment;
- a person with Alzheimer's disease, using an adapted conversational profile;
- an isolated person;
- a person needing regular, non-medical follow-up.

### 5.2 Primary customer

The person who sets up and pays for the service:

- a child;
- a spouse;
- a sibling;
- a family member;
- a caregiver;
- a legal representative.

For the hackathon MVP, the primary commercial target is:

> **A relative who wants to watch over a vulnerable family member without being able to call them constantly.**

### 5.3 Secondary targets

In the longer term, KinCall could be used by:

- home-care services;
- independent-living residences;
- associations;
- specialized facilities;
- mutual insurers;
- insurers;
- telecare services.

These targets are not part of the MVP's priority scope.

---

## 6. Value proposition

### For the vulnerable person

- receiving a regular call;
- being able to talk without feeling interrogated;
- not having to take the initiative to bother their relatives;
- benefiting from a stable, familiar presence;
- being helped when something is wrong.

### For relatives

- being reassured without having to call several times a day;
- being alerted only when a situation deserves their attention;
- receiving a clear, contextualized summary;
- avoiding having to manually coordinate the whole family;
- knowing who answered and who can help.

### For the hackathon

KinCall demonstrates that CALL-E can be used not just to place a call, but to orchestrate several specialized telephone agents around a concrete human need.

---

## 7. Product principles

### 7.1 Conversation before questionnaire

KinCall must not give the impression of following a rigid list of questions.

The agent must naturally weave important elements into the conversation.

Example:

> Hello Marie. How are you today? You told me about your garden last time. Were you able to tend to it this week?

The person can then answer naturally:

> No, I haven't gone out since my fall.

This information can be identified without the call feeling like a medical interrogation.

### 7.2 A familiar presence

The same agent must keep:

- the same first name;
- the same voice;
- a consistent tone;
- a limited memory of previous conversations;
- knowledge of authorized interests and habits.

The goal is to create a recognizable and reassuring interaction.

### 7.3 Specialized agents

A single agent should not do everything.

Each type of call has:

- a different goal;
- a different level of conciseness;
- an adapted tone;
- specific information to convey;
- distinct rules.

### 7.4 Orchestration invisible to the user

The vulnerable person should not have to understand the technical architecture.

To them, KinCall remains a single, coherent presence.

The multi-agent architecture is used behind the scenes to improve the system's safety, accuracy, and efficiency.

### 7.5 The human stays in charge

KinCall supports relatives but does not replace their judgment.

The product must not:

- make a diagnosis;
- prescribe a treatment;
- assert that a person is safe;
- substitute for a professional;
- trigger unauthorized critical actions without control.

---

## 8. Multi-agent architecture

KinCall relies on several specialized agents coordinated by a central orchestrator.

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

## 9. The agents

### 9.1 Companion Agent

#### Mission

Create a natural conversation with the vulnerable person and gather useful information without turning the call into a questionnaire.

#### Behavior

The Companion Agent:

- calls the person at the scheduled time;
- clearly identifies itself as an automated assistant;
- uses a stable voice and first name;
- starts the conversation from a familiar topic;
- remembers authorized elements from previous conversations;
- lets the person talk;
- rephrases if an answer is ambiguous;
- asks simple questions;
- avoids anxiety-inducing phrasing;
- adapts its language to the registered profile;
- ends the call calmly.

#### Adaptation examples

##### Standard profile

- warm conversation;
- open-ended questions;
- references to previous habits.

##### Person with cognitive impairment

- short sentences;
- one question at a time;
- no guilt-inducing phrasing;
- repetition allowed;
- no questions like "Don't you remember?"

##### Person with speech difficulty

- longer pauses;
- no interrupting;
- rephrasing to confirm;
- simple answers accepted.

#### Responsibilities

The Companion Agent can:

- converse;
- clarify information;
- extract important facts;
- produce a structured report.

It cannot:

- decide on an escalation by itself;
- make a diagnosis;
- call relatives;
- call emergency services;
- promise that someone will help.

#### Expected output

```json
{
  "call_status": "completed",
  "conversation_summary": "Marie says she fell yesterday and is having difficulty walking.",
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

Analyze the Companion Agent's report and decide the next authorized action.

The Orchestrator never places a call directly.

#### Inputs

- the Companion Agent's structured result;
- the person's profile;
- rules configured by the family;
- the ordered list of contacts;
- recent history;
- the status of previous calls;
- safety restrictions.

#### Possible decisions

```text
NO_ACTION
LOG_AND_CLOSE
RETRY_CHECK_IN
CONTACT_TRUSTED_PERSON
CONTACT_NEXT_TRUSTED_PERSON
REQUEST_HUMAN_REVIEW
ACTIVATE_CONFIGURED_ESCALATION
```

#### Example of simplified logic

```text
If the call was not answered:
    schedule another attempt;
    if the maximum number of attempts has been reached:
        contact the first relative.

If the person mentions a fall with no current difficulty:
    contact a relative according to the configured rules.

If the person mentions a fall and cannot move:
    high priority;
    immediately contact the first relative;
    continue the cascade if no one confirms taking charge.

If no unusual signal is detected:
    close the call;
    log a summary.
```

#### Expected output

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

Efficiently inform a relative and obtain a confirmation of help.

Unlike the Companion Agent, the Family Agent does not try to hold a long conversation.

It must be:

- direct;
- factual;
- calm;
- transparent;
- decision-oriented.

#### Example call

> Hello Julie. I'm KinCall, the telephone assistant set up to regularly check in on your mother.
>
> I just finished a call with her. She told me she fell yesterday and is having difficulty walking today. She didn't want to bother you.
>
> Could you call her back or go see her today?

#### Responses sought

- the relative can help;
- the relative cannot help;
- the relative asks for more information;
- the relative wants to call the person themselves;
- the relative asks to contact the next person;
- no answer;
- busy signal;
- call declined.

#### Expected output

```json
{
  "contact_id": "contact_julie",
  "answered": true,
  "situation_understood": true,
  "can_intervene": true,
  "intervention_type": "visit",
  "estimated_time": "18:00",
  "contact_next_person": false,
  "summary": "Julie confirms she will visit Marie at 18:00."
}
```

#### Behavior on failure

```text
Julie does not answer
        ↓
Orchestrator receives NO_ANSWER
        ↓
Marc is selected
        ↓
Family Agent calls Marc
        ↓
Marc confirms he can help
        ↓
The cascade stops
```

### 9.4 Escalation Agent

#### Status in the MVP

The Escalation Agent can be presented in the architecture, but its integration with real emergency services is not part of the core MVP.

#### Mission

Apply an escalation procedure explicitly configured by the family or the responsible organization.

Depending on the authorized context, it can:

- call a professional caregiver;
- call a telecare service;
- call a designated manager;
- forward the necessary information to a human operator;
- prepare a situation file;
- request human validation.

#### Critical limitation

KinCall must not be presented as a device that guarantees a medical emergency will be handled.

In the MVP:

- no real call is made to firefighters, emergency medical services, or a hospital;
- emergency scenarios are simulated or redirected to an authorized test number;
- human validation is required before any critical action.

---

## 10. Trusted circle

Each vulnerable person has an ordered trusted circle.

Example:

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

The order determines the call cascade.

The Orchestrator stops the cascade as soon as a contact confirms they are taking charge of the situation.

---

## 11. Main user journey

### 11.1 Setup

The relative creates the vulnerable person's profile.

They provide:

- first name;
- phone number;
- language;
- preferred times;
- call frequency;
- adaptation needs;
- authorized interests;
- trusted contacts;
- contact order;
- escalation rules;
- consents.

### 11.2 Regular call

At the scheduled time:

1. the Companion Agent calls;
2. the person answers;
3. a natural conversation begins;
4. relevant information is extracted;
5. a structured report is generated.

### 11.3 Decision

The Orchestrator analyzes the report.

It can:

- close the event;
- schedule a new call;
- contact a relative;
- launch a cascade;
- request human intervention.

### 11.4 Coordination

The Family Agent calls contacts in the defined order.

Each call seeks a concrete answer:

> Can you help?

### 11.5 Closing

The event is closed when one condition is met:

- no problem was detected;
- a relative confirmed they would help;
- a human operator took over the case;
- the configured procedure is complete.

---

## 12. Main MVP scenario

### Context

Marie is 82 years old and lives alone.

Her daughter Julie set up KinCall to call her every morning.

### Walkthrough

#### Step 1 — Calling the person

The Companion Agent calls Marie.

> Hello Marie. How are you this morning? Last time, you told me you wanted to tend to your garden.

Marie replies:

> I couldn't. I fell yesterday, but I didn't want to bother Julie.

The Companion Agent calmly clarifies:

> I'm sorry to hear that. Are you able to get around today?

Marie replies:

> Only with great difficulty.

#### Step 2 — Analysis

The Companion Agent produces a report:

```json
{
  "fall_mentioned": true,
  "mobility_difficulty": true,
  "does_not_want_to_disturb_family": true,
  "attention_level": "high"
}
```

#### Step 3 — Orchestration

The Orchestrator decides to contact Julie.

#### Step 4 — Calling the relative

The Family Agent calls Julie.

> Hello Julie. I just spoke with your mother. She told me she fell yesterday and is having difficulty getting around. She didn't want to bother you. Could you go see her today?

Julie replies:

> Yes, I'll go around 6 p.m.

#### Step 5 — Confirmation

The dashboard shows:

```text
Marie Dupont
Situation: help confirmed

Event detected:
- fall mentioned;
- difficulty getting around.

Actions:
- Julie contacted;
- visit confirmed at 18:00.
```

---

## 13. MVP features

### 13.1 Required

- creating a vulnerable-person profile;
- creating a trusted circle;
- configuring contact order;
- manually launching a demo call;
- a CALL-E call to the vulnerable person;
- natural conversation;
- call summary;
- structured information extraction;
- simple classification of the situation;
- triggering the Orchestrator;
- a CALL-E call to a relative;
- retrieving their answer;
- cascading to the next contact if unanswered;
- stopping the cascade after confirmation;
- a dashboard showing workflow status;
- a history of calls and decisions.

### 13.2 Optional

- recurring scheduling;
- conversation memory;
- multiple conversational profiles;
- voice customization;
- language selection;
- a new call to the person to confirm a relative is on their way;
- a summary sent by email or SMS;
- calling a test professional caregiver.

### 13.3 Out of scope for the MVP

- medical diagnosis;
- clinical analysis;
- real calls to emergency services;
- connection to a medical record;
- prescription management;
- certified recognition of medical conditions;
- continuous monitoring;
- sensor-based fall detection;
- real-time location tracking;
- billing;
- a full mobile application;
- a portal for nursing homes;
- integration with real hospitals.

---

## 14. MVP interface

### 14.1 Home page

Content:

- a short introduction to KinCall;
- an "Add a loved one" button;
- a list of existing profiles.

### 14.2 Person profile page

```text
Marie Dupont
Age 82

Status
Needs attention

Next check-in
Tomorrow at 09:00

Trusted circle
1. Julie — Daughter
2. Marc — Son
3. Nicole — Neighbour
```

### 14.3 Event view

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

### 14.4 Summary

```text
What happened?
Marie mentioned that she fell yesterday and currently has difficulty walking.

What did KinCall do?
KinCall contacted the trusted circle.

Who is taking care of it?
Marc confirmed that he will visit at 17:30.
```

---

## 15. Event states

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

## 16. Core data

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

## 17. Safety rules

### 17.1 Consent

The people being called must have agreed to:

- receive automated calls;
- have their conversations analyzed;
- have certain information shared with designated contacts.

### 17.2 Transparency

KinCall must always identify itself as an automated agent.

It must not claim to be:

- a family member;
- a doctor;
- a nurse;
- a public service;
- a human emergency operator.

### 17.3 Shared data

The Family Agent must share only the information necessary for the relative to help.

It must not share the full conversation without authorization.

### 17.4 Emergencies

For the hackathon:

- calls to emergency services are excluded from the real scenario;
- calls are made only to authorized test numbers;
- the Escalation Agent is presented as a future extension;
- no medical promise is made.

### 17.5 Uncertainty

When information is uncertain, KinCall must use cautious wording.

Example:

> Marie indicated she is having difficulty walking.

And not:

> Marie can no longer walk.

### 17.6 False positives

The system must distinguish between:

- an explicitly stated fact;
- an interpretation;
- a change from usual habits;
- uncertain data.

---

## 18. Success indicators

For the MVP, the demonstration indicators are:

- the call to the person executed correctly;
- conversation completed;
- structured result retrieved;
- the relevant situation correctly identified;
- an orchestration decision generated;
- a call to a relative triggered;
- the relative's answer extracted;
- a working cascade when there is no answer;
- help confirmed;
- dashboard updated;
- the full scenario completed without manual technical intervention.

### Future product indicators

- answered-call rate;
- rate of situations handled;
- average time before a relative confirms;
- average number of contacts called;
- false-positive rate;
- rate of unnecessary escalations;
- relatives' satisfaction;
- satisfaction of the people called;
- service retention rate.

---

## 19. Differentiation

KinCall distinguishes itself from a standard voice agent through four elements.

### 19.1 Adaptive conversation

The Companion Agent adapts its behavior to the person's profile.

### 19.2 Relational memory

The agent can use certain elements from previous conversations to make the call feel more natural.

### 19.3 Multi-agent architecture

Each type of call is handled by a specialized agent.

### 19.4 Telephone orchestration

KinCall does not simply detect a situation. It contacts the appropriate people until help is confirmed.

---

## 20. Why CALL-E is essential

Without CALL-E, KinCall cannot deliver its core value proposition.

The product relies on the ability to:

- call a person who does not necessarily use an app;
- hold a voice conversation;
- adapt to responses;
- gather information;
- call multiple contacts;
- handle no-answers and failures;
- obtain verbal commitments;
- retrieve transcripts and structured results.

The phone is therefore not a secondary feature.

> **The phone is KinCall's primary interface and means of action.**

---

## 21. Positioning for the hackathon

### Short statement

> **KinCall is a multi-agent phone care coordinator that checks in on vulnerable people and automatically coordinates their trusted contacts when something seems wrong.**

### 30-second pitch

> Many vulnerable people live alone and do not always tell their families when something is wrong because they do not want to disturb them. KinCall uses a familiar conversational agent to call them regularly. If an unusual situation is detected, an orchestrator launches a specialised family agent that contacts trusted relatives until someone confirms they can help. KinCall does not replace families. It helps them stay present when it matters most.

### Core message

> **KinCall does not simply detect that something is wrong. It makes sure that someone takes care of it.**

---

## 22. Hackathon demo

### Target duration

Under three minutes.

### Scenario

#### 0:00–0:20 — Problem

Introducing Marie, 82, living alone.

Her daughter cannot call her every morning.

#### 0:20–1:10 — Companion Agent

KinCall calls Marie.

She mentions a fall and explains she didn't want to bother her daughter.

#### 1:10–1:25 — Orchestrator

The dashboard shows:

```text
Fall mentioned
Mobility difficulty detected
Trusted contact required
```

#### 1:25–2:10 — Family Agent

KinCall calls Julie.

One possible scenario:

- Julie does not answer;
- the Orchestrator calls Marc.

Marc answers and confirms he will visit at 5:30 p.m.

#### 2:10–2:40 — Result

The dashboard shows:

```text
Situation detected
Marc contacted
Visit confirmed at 17:30
Case closed
```

#### 2:40–3:00 — Conclusion

Presenting the architecture:

```text
Companion Agent
      ↓
Orchestrator
      ↓
Family Agent
```

Conclusion:

> **One conversation detected the problem. A coordinated sequence of calls made sure someone would help.**

---

## 23. Development priorities

### Priority 1 — Main loop

- Marie's profile;
- Companion call;
- structured extraction;
- Orchestrator decision;
- Family call;
- confirmation;
- dashboard.

### Priority 2 — Cascade

- first relative with no answer;
- calling the second relative;
- stopping after confirmation.

### Priority 3 — Personalization

- conversational profile;
- simple memory;
- interests;
- adapted tone.

### Priority 4 — Presentation

- a clear interface;
- timeline;
- architecture;
- video;
- documentation;
- the GitHub contribution tied to the hackathon.

---

## 24. Project risks

### Technical risk

Conversation quality may vary.

**Mitigation:**

- limiting the demo scenario;
- preparing precise instructions;
- using structured results;
- providing a simulation mode for rehearsals.

### Over-complexity risk

The product could become too broad.

**Mitigation:**

The MVP is limited to:

```text
Call the person
        ↓
Detect a situation
        ↓
Call relatives
        ↓
Obtain confirmation
```

### Medical risk

The product could be perceived as a medical device.

**Mitigation:**

- no diagnosis;
- no medical recommendation;
- no real calls to emergency services;
- positioning centered on communication and coordination.

### Ethical risk

The person may feel surveilled.

**Mitigation:**

- explicit consent;
- transparency;
- natural conversation;
- minimal data;
- control by the person and their relatives.

---

## 25. Non-goals

KinCall does not aim to:

- replace family conversations;
- impersonate a family member;
- secretly monitor a person;
- replace certified telecare;
- replace a healthcare professional;
- diagnose an illness;
- decide alone on a medical intervention;
- automatically call emergency services without a controlled procedure.

---

## 26. Final summary

KinCall is a multi-agent system built on CALL-E.

Its core operation is simple:

```text
1. A Companion Agent calls a vulnerable person.

2. It holds a familiar, adapted conversation.

3. An Orchestrator analyzes the report.

4. When an unusual situation is detected,
   a Family Agent calls relatives.

5. Contacts are called in the planned order
   until someone confirms they will help.

6. The result is recorded and shown on a dashboard.
```

KinCall's value does not lie solely in detecting a problem.

It lies in its ability to turn a conversation into concrete action:

> **Someone was informed, someone answered, and someone will help.**
