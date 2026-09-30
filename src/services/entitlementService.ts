import { Entitlement } from '../models/Entitlement.js';
import { Program } from '../models/Program.js';

export async function getActiveEntitlements(installationId: string): Promise<string[]> {
  const rows = await Entitlement.find({
    installationId,
    verificationStatus: 'verified',
    entitlementStatus: 'active',
  }).select('programSlug');
  return rows.map((r) => r.programSlug);
}

export async function hasProgramAccess(
  installationId: string,
  programSlug: string
): Promise<boolean> {
  const count = await Entitlement.countDocuments({
    installationId,
    programSlug,
    verificationStatus: 'verified',
    entitlementStatus: 'active',
  });
  return count > 0;
}

export async function grantEntitlement(params: {
  installationId: string;
  programSlug: string;
  purchaseSource: 'apple' | 'google' | 'web' | 'dev_simulator';
  storeTransactionId: string;
  rawReceiptRef?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const program = await Program.findOne({ slug: params.programSlug, published: true });
  if (!program) {
    throw new Error('PROGRAM_NOT_FOUND');
  }

  await Entitlement.findOneAndUpdate(
    { storeTransactionId: params.storeTransactionId, programSlug: params.programSlug },
    {
      $set: {
        installationId: params.installationId,
        purchaseSource: params.purchaseSource,
        storeTransactionId: params.storeTransactionId,
        programSlug: params.programSlug,
        verificationStatus: 'verified',
        entitlementStatus: 'active',
        rawReceiptRef: params.rawReceiptRef,
        metadata: params.metadata,
      },
    },
    { upsert: true, new: true }
  );
}

export async function linkInstallationToExistingPurchase(
  installationId: string,
  storeTransactionId: string,
  programSlug: string
): Promise<boolean> {
  const existing = await Entitlement.findOne({
    storeTransactionId,
    programSlug,
    verificationStatus: 'verified',
    entitlementStatus: 'active',
  });
  if (!existing) return false;
  await Entitlement.updateOne(
    { _id: existing._id },
    { $set: { installationId } }
  );
  return true;
}
