import type { ConceptProposer } from "../conceitos/propose.js";
import type { NegativeWriter } from "../guardian/negative-contract.js";
import type { JourneyProposer } from "../look/journey-propose.js";
import type { InputProposer } from "../teach/types.js";
import { callProvider, type ProviderDeps, valueOf } from "./call.js";
import { fileContent, inputOnly, journeySteps, stringList } from "./validate.js";

export const providerCodeConcepts =
  (deps: ProviderDeps): ConceptProposer =>
  (touch) =>
    valueOf(
      callProvider(deps, {
        kind: "code-concepts",
        payload: { file: touch.file, lines: [...touch.lines] },
        validate: stringList,
      }),
    );

export const providerNegativeTest =
  (deps: ProviderDeps): NegativeWriter =>
  (proposal) =>
    proposal.file === null
      ? undefined
      : valueOf(
          callProvider(deps, {
            kind: "negative-test",
            payload: {
              premise: proposal.premise,
              criterion: proposal.criterion,
              run: proposal.run,
              file: proposal.file,
              skeleton: proposal.skeleton,
            },
            validate: fileContent,
          }),
        );

export const providerTeachInput =
  (deps: ProviderDeps): InputProposer =>
  (context) =>
    valueOf(
      callProvider(deps, {
        kind: "teach-input",
        payload: { concepts: [...context.concepts], run: context.run, input: context.input },
        validate: inputOnly,
      }),
    );

export const providerJourney =
  (deps: ProviderDeps): JourneyProposer =>
  (request) =>
    Promise.resolve(
      valueOf(
        callProvider(deps, {
          kind: "journey",
          payload: { sentence: request.sentence, routes: [...request.routes] },
          validate: journeySteps,
        }),
      ),
    );
