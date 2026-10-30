----------------------------- MODULE ReviewLoop -----------------------------
(* The review-loop state machine in plugins/review-loop/skills/review-loop/scripts/loop.mjs, in a project
   with a test check. `loop` is what state.json holds, one action is one loop.mjs command, and each
   command's state change is one step. DecideNext comes from DecideNextTable, which
   scripts/check-loop-model.mjs generates from the exported decideNext before every run. *)
EXTENDS Naturals, Sequences, FiniteSets, DecideNextTable

CONSTANTS N, MaxRounds, RoundLimit

ASSUME N = TableSlots /\ MaxRounds = TableMaxRounds /\ RoundLimit = TableRoundLimit

Slots == 1..N

\* UNFINISHED in loop.mjs.
Unfinished == {"review", "fix", "proof"}

\* What a reviewer result can add for one finding. A card (P3 to P5, or a P1 or P2 without evidence) never
\* blocks a stop, so the model leaves cards out.
\* reviewerFix: an evidenced P1 or P2 with no ask flag, so classify routes it to fix.
\* reviewerAsk: an evidenced P1 or P2 with an ask flag other than multipleFixes alone (behaviorChange, ...).
\* reviewerAskMultipleFixes: an evidenced P1 or P2 whose only ask flag is multipleFixes (unattendedFixable).
\* checkFix: a failing typecheck, lint, or test (fromChecks), which needs no regression proof.
Shapes == {"reviewerFix", "reviewerAsk", "reviewerAskMultipleFixes", "checkFix"}

Fresh == [where |-> "unreported", kind |-> "none", route |-> "none", fixable |-> FALSE, attempts |-> 0,
          decision |-> "none", regression |-> "none"]

VARIABLES loop, cmd

InState(l, place) == {s \in Slots : l.findings[s].where = place}

\* needsProof in loop.mjs: a resolved P1 or P2 not from a failing check, with no regression proof.
\* regression is "test" for a draft that hasRegressionProof accepts and "noTest" for a no-test reason.
Unproven(l) == {s \in Slots : /\ l.findings[s].where = "resolved"
                              /\ l.findings[s].kind = "reviewer"
                              /\ l.findings[s].regression = "none"}

\* pendingDecisionIds in loop.mjs, without cards.
Pending(l) == {s \in Slots : l.findings[s].where \in {"open", "deferred"} /\ l.findings[s].decision = "none"}

\* isInProgress in loop.mjs.
InProgress(l) == l.awaiting \in Unfinished \/ Pending(l) # {}

Stopped(l, reason, by) ==
  [l EXCEPT !.awaiting = "decisions", !.stopReason = reason, !.stoppedBy = by, !.stopUnproven = (Unproven(l) # {})]

\* stopIfProven in loop.mjs. It acts only in the proof state once needsProof is empty, then runs the final checks:
\* they pass and the loop stops, a check fails that a new regression test explains and that test loses its proof,
\* or a check fails that no new test explains and the loop goes back to fix.
StopIfProven(l) ==
  IF l.awaiting # "proof" \/ Unproven(l) # {} THEN {l}
  ELSE LET tested == {s \in InState(l, "resolved") : l.findings[s].regression = "test"}
       IN {Stopped(l, IF InState(l, "deferred") # {} THEN "waiting" ELSE "clean", "stopIfProven"),
           [l EXCEPT !.awaiting = "fix"]}
          \cup {[l EXCEPT !.findings = [s \in Slots |-> IF s \in blamed
                                                        THEN [l.findings[s] EXCEPT !.regression = "none"]
                                                        ELSE l.findings[s]]]
                : blamed \in (SUBSET tested) \ {{}}}

\* makeUnattended in loop.mjs, with finishFixing when a fix round has nothing left to fix: decideNext with no open
\* finding holds for proof while a resolved finding lacks it, else stops as waiting or clean.
MakeUnattended(l) ==
  LET asking == IF l.awaiting = "fix" THEN {s \in InState(l, "open") : l.findings[s].route = "ask"} ELSE {}
      moved == {s \in asking : ~(l.findings[s].attempts = 0 /\ l.findings[s].fixable)}
      l1 == [l EXCEPT !.unattended = TRUE,
                      !.findings = [s \in Slots |->
                        CASE s \in moved -> [l.findings[s] EXCEPT !.where = "deferred"]
                          [] s \in asking -> [l.findings[s] EXCEPT !.route = "unattendedFix"]
                          [] OTHER -> l.findings[s]]]
  IN IF l.awaiting = "fix" /\ InState(l1, "open") = {}
     THEN IF Unproven(l1) # {} THEN [l1 EXCEPT !.awaiting = "proof"]
          ELSE Stopped(l1, IF InState(l1, "deferred") # {} THEN "waiting" ELSE "clean", "stopWaiting")
     ELSE l1

\* makeAttended in loop.mjs.
MakeAttended(l) ==
  [l EXCEPT !.unattended = FALSE,
            !.findings = [s \in Slots |->
              IF l.findings[s].where = "open" /\ l.findings[s].route = "unattendedFix"
              THEN [l.findings[s] EXCEPT !.route = "ask"]
              ELSE l.findings[s]]]

\* assignIds, classify, and the unattended split in recordReview.
NewFinding(shape, unattended) ==
  CASE shape = "reviewerFix" -> [Fresh EXCEPT !.where = "open", !.kind = "reviewer", !.route = "fix"]
    [] shape = "checkFix" -> [Fresh EXCEPT !.where = "open", !.kind = "check", !.route = "fix"]
    [] shape = "reviewerAsk" ->
         [Fresh EXCEPT !.where = IF unattended THEN "deferred" ELSE "open", !.kind = "reviewer", !.route = "ask"]
    [] shape = "reviewerAskMultipleFixes" ->
         [Fresh EXCEPT !.where = "open", !.kind = "reviewer", !.fixable = TRUE,
                       !.route = IF unattended THEN "unattendedFix" ELSE "ask"]

\* recordReview in loop.mjs: res is review.resolved (and the failing checks that now pass), new holds the
\* findings the reviewer reports, and regr says one of them repeats an earlier resolved finding.
AfterRecord(l, res, new, shape, regr) ==
  LET f == l.findings
      notResolved == InState(l, "open") \ res
      keptInLoop == {s \in notResolved : f[s].decision = "keep"}
      carried == notResolved \ keptInLoop
      stuck == {s \in carried : f[s].attempts + 1 >= 2}
      retried == carried \ stuck
      findings == [s \in Slots |->
        CASE s \in res -> [f[s] EXCEPT !.where = "resolved"]
          [] s \in keptInLoop -> [f[s] EXCEPT !.where = "kept"]
          [] s \in stuck -> [f[s] EXCEPT !.attempts = @ + 1]
          [] s \in retried -> [f[s] EXCEPT !.attempts = @ + 1, !.route = "ask",
                                           !.where = IF l.unattended THEN "deferred" ELSE "open"]
          [] s \in new -> NewFinding(shape[s], l.unattended)
          [] OTHER -> f[s]]
      l1 == [l EXCEPT !.findings = findings]
      open == Cardinality(InState(l1, "open"))
      counts == Append(l.counts, open)
      next == DecideNext(counts, Cardinality(InState(l1, "deferred")), Cardinality(Unproven(l1)),
                         Cardinality(stuck), IF regr THEN 1 ELSE 0)
      l2 == [l1 EXCEPT !.counts = counts]
  IN IF next.decision = "stop" THEN Stopped(l2, next.reason, "decideNext")
     ELSE [l2 EXCEPT !.awaiting = IF next.reason = "proof" THEN "proof" ELSE "fix"]

\* next in loop.mjs from the fix state: a fix that weakens tests stops the loop as integrity, any other fix
\* starts the next round's review.
FixRound(l) == {Stopped(l, "integrity", "integrity"), [l EXCEPT !.round = @ + 1, !.awaiting = "review"]}

\* isBeingFixed in loop.mjs.
BeingFixed(l, s) ==
  LET f == l.findings[s]
  IN /\ f.kind = "reviewer"
     /\ \/ l.awaiting = "fix" /\ f.where \in {"open", "deferred"}
        \/ f.decision = "once"
        \/ f.where = "resolved" /\ (l.awaiting = "proof" \/ f.regression = "none")

Init ==
  /\ loop = [awaiting |-> "none", round |-> 0, counts |-> <<>>, unattended |-> FALSE, stopReason |-> "none",
             stoppedBy |-> "none", stopUnproven |-> FALSE, findings |-> [s \in Slots |-> Fresh]]
  /\ cmd = [name |-> "init"]

\* start in loop.mjs with no saved state.
StartFresh ==
  /\ loop.awaiting = "none"
  /\ \E unattended \in BOOLEAN :
       /\ loop' = [loop EXCEPT !.awaiting = "review", !.round = 1, !.unattended = unattended]
       /\ cmd' = [name |-> "start", unattended |-> unattended, resume |-> FALSE]

\* start in loop.mjs with a run in progress: stopIfProven, then makeUnattended or makeAttended.
StartResume ==
  /\ loop.awaiting # "none"
  /\ InProgress(loop)
  /\ \E l1 \in StopIfProven(loop), unattended \in BOOLEAN :
       LET l2 == IF unattended THEN MakeUnattended(l1) ELSE MakeAttended(l1)
       IN /\ l2 # loop
          /\ loop' = l2
          /\ cmd' = [name |-> "start", unattended |-> unattended, resume |-> TRUE]

\* record in loop.mjs (recordReview). Slots are reported in order, so new is the next k unreported slots.
Record ==
  /\ loop.awaiting = "review"
  /\ \E res \in SUBSET (InState(loop, "open") \cup InState(loop, "deferred")),
        k \in 0..Cardinality(InState(loop, "unreported")) :
       LET new == {s \in InState(loop, "unreported") : s <= N - Cardinality(InState(loop, "unreported")) + k}
       IN \E shape \in [new -> Shapes],
             regr \in IF InState(loop, "resolved") # {} /\ new # {} THEN BOOLEAN ELSE {FALSE} :
            /\ loop' = AfterRecord(loop, res, new, shape, regr)
            /\ cmd' = [name |-> "record", round |-> loop.round, resolved |-> res,
                       new |-> {<<s, shape[s]>> : s \in new}, regression |-> regr]

\* next in loop.mjs. From the proof state it runs stopIfProven first; if the final checks send the loop back
\* to fix, the same command goes on into the fix round. With proof still missing it throws and saves nothing.
NextCommand ==
  \/ /\ loop.awaiting = "fix"
     /\ \E l2 \in FixRound(loop) : loop' = l2 /\ cmd' = [name |-> "next"]
  \/ /\ loop.awaiting = "proof"
     /\ \E l1 \in StopIfProven(loop) \ {loop} :
          \E l2 \in IF l1.awaiting = "fix" THEN FixRound(l1) ELSE {l1} : loop' = l2 /\ cmd' = [name |-> "next"]

\* rule in loop.mjs: a regression test draft or a no-test reason for one finding, then stopIfProven.
\* outcome "test" is a draft that fails on the code before the fix (caught), "missed" is one that does not.
\* A finding decided as a rule records a rule draft instead, which leaves its regression proof as it was.
RuleCommand ==
  \E s \in Slots :
    /\ loop.findings[s].where \in {"open", "deferred", "kept", "resolved"}
    /\ IF loop.findings[s].decision = "rule"
       THEN \E l2 \in StopIfProven(loop) \ {loop} :
              loop' = l2 /\ cmd' = [name |-> "rule", slot |-> s, outcome |-> "ruleDraft"]
       ELSE /\ BeingFixed(loop, s)
            /\ \E outcome \in {"noTest", "test", "missed"} :
                 LET l1 == [loop EXCEPT !.findings[s].regression = IF outcome = "missed" THEN "none" ELSE outcome]
                 IN \E l2 \in StopIfProven(l1) :
                      /\ l2 # loop
                      /\ loop' = l2
                      /\ cmd' = [name |-> "rule", slot |-> s, outcome |-> outcome]

\* decide in loop.mjs. It does not look at awaiting, so it can run in any state.
DecideCommand ==
  /\ loop.awaiting # "none"
  /\ \E s \in Slots, choice \in {"keep", "once", "rule"} :
       /\ loop.findings[s].where \in {"open", "deferred"}
       /\ loop.findings[s].decision # choice
       /\ loop' = [loop EXCEPT !.findings[s].decision = choice]
       /\ cmd' = [name |-> "decide", slot |-> s, choice |-> choice]

\* unattended --on or --off in loop.mjs (setUnattended) with a saved state.
UnattendedCommand ==
  /\ loop.awaiting # "none"
  /\ \E on \in BOOLEAN :
       LET l2 == IF on THEN MakeUnattended(loop) ELSE MakeAttended(loop)
       IN /\ l2 # loop
          /\ loop' = l2
          /\ cmd' = [name |-> "unattended", on |-> on]

Next == StartFresh \/ StartResume \/ Record \/ NextCommand \/ RuleCommand \/ DecideCommand \/ UnattendedCommand

\* TLC treats states that differ only in the last command as one state.
View == loop

WithinBounds == loop.round <= RoundLimit

\* reviewVerdict in loop.mjs, when HEAD, the working tree, and the staged tree all match the review and no
\* skip-once is pending: deny while a resolved finding lacks proof in any state, while the loop is
\* unfinished, or while a finding waits for a decision. Otherwise it allows the commit or asks to confirm it.
GateAllows(l) ==
  /\ l.awaiting # "none"
  /\ Unproven(l) = {}
  /\ l.awaiting \notin Unfinished
  /\ Pending(l) = {}

\* The properties. Each stop invariant reads the loop as it was at the moment it stopped.
DecideNextStopHasProof == loop.stoppedBy = "decideNext" /\ loop.stopReason \in {"clean", "waiting"} => ~loop.stopUnproven
StopIfProvenStopHasProof == loop.stoppedBy = "stopIfProven" => ~loop.stopUnproven
StopWaitingStopHasProof == loop.stoppedBy = "stopWaiting" => ~loop.stopUnproven
GateNeedsProof == GateAllows(loop) => Unproven(loop) = {}

\* A modeling check, not a property: decideNext gets round = Len(counts) from the table.
RoundMatchesCounts == loop.awaiting = "review" => Len(loop.counts) + 1 = loop.round
=============================================================================
