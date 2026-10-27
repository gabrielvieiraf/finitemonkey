import type { ItemId } from "../blueprints.js";

export interface ItemText {
  readonly title: string;
  readonly why: string;
  readonly minimum: string;
}

export type BlueprintText = Readonly<Record<ItemId, ItemText>>;
