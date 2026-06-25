export type BundleUnitType = "workpad_task" | "child_run";

export interface BundleUnit {
  id: string;
  type: BundleUnitType;
  issue?: string | null;
  repo?: string | null;
  produces?: string[];
  consumes?: string[];
  dependsOn?: string[];
  deliverable?: string | null;
}

export type ContractStatus = "draft" | "ready" | "changing";

export interface SharedContract {
  id: string;
  kind?: string | null;
  ownerUnit?: string | null;
  consumers?: string[];
  status: ContractStatus;
}

export interface ExecutionBundle {
  mode?: string | null;
  parent?: string | null;
  units: BundleUnit[];
  sharedContracts: SharedContract[];
}
