import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, type PublicOrderDetails, type PublicVerificationResult } from "./services/api";
import { publicVerificationTitle } from "./public-verification";
import "./PublicVerificationPage.css";

type StageStatus =
  | "waiting"
  | "loading"
  | "success"
  | "failed"
  | "pending"
  | "unavailable"
  | "skipped";

interface VerificationStage {
  id: number;
  title: string;
  loadingText: string;
  status: StageStatus;
  detail?: string;
}

interface VerificationViewState {
  recordId: string;
  attempt: number;
  order: PublicOrderDetails | null;
  result: PublicVerificationResult | null;
  stages: VerificationStage[];
}

function createStages(): VerificationStage[] {
  return [
    { id: 1, title: "Retrieving order information", loadingText: "Finding your order...", status: "loading" },
    { id: 2, title: "Retrieving the RetailTrace record", loadingText: "Fetching the published blockchain record...", status: "waiting" },
    { id: 3, title: "Checking blockchain publication", loadingText: "Checking the blockchain transaction...", status: "waiting" },
    { id: 4, title: "Verifying data integrity", loadingText: "Comparing the published record with its blockchain commitment...", status: "waiting" },
    { id: 5, title: "Preparing verification results", loadingText: "Preparing your verification report...", status: "waiting" },
  ];
}

function formatDate(value: string | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function fallbackResult(
  status: PublicVerificationResult["status"],
  explanation: string,
  order?: PublicOrderDetails | null,
): PublicVerificationResult {
  return {
    status,
    ...(order?.orderReference ? { orderReference: order.orderReference } : {}),
    ...(order?.retailTraceRecordId ? { recordId: order.retailTraceRecordId } : {}),
    ...(order?.transactionId !== undefined ? { transactionId: order.transactionId } : {}),
    ...(order?.publicationStatus !== undefined
      ? { publicationStatus: order.publicationStatus }
      : {}),
    verificationTimestamp: new Date().toISOString(),
    checks: {
      transactionExists: null,
      recordFound: status === "NOT_VERIFIED" ? false : null,
      commitmentMatches: null,
    },
    explanation,
  };
}

function resultMessage(result: PublicVerificationResult) {
  switch (result.status) {
    case "VERIFIED":
      return "The record associated with this purchase was successfully found on RetailTrace. Its published blockchain commitment matches the record being verified.";
    case "PENDING":
      return "The RetailTrace record is available, but its blockchain transaction is not yet confirmed. Please try again later.";
    case "UNAVAILABLE":
      return "Verification is temporarily unavailable. Please try again later.";
    case "NOT_VERIFIED":
      return result.explanation || "We could not verify this order's blockchain record.";
  }
}

export default function PublicVerificationPage() {
  const { recordId = "" } = useParams();
  const location = useLocation();
  const isReceiptView = location.pathname.endsWith("/receipt");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<VerificationViewState>({
    recordId: "",
    attempt: -1,
    order: null,
    result: null,
    stages: createStages(),
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const isCurrentView = view.recordId === recordId && view.attempt === attempt;
  const order = isCurrentView ? view.order : null;
  const result = isCurrentView ? view.result : null;
  const stages = isCurrentView ? view.stages : createStages();

  useEffect(() => {
    let active = true;
    const update = (changes: Partial<VerificationViewState>) => {
      if (!active) return;
      setView((current) => {
        const base = current.recordId === recordId && current.attempt === attempt
          ? current
          : {
              recordId,
              attempt,
              order: null,
              result: null,
              stages: createStages(),
            };
        return { ...base, ...changes };
      });
    };
    const updateStage = (
      id: number,
      status: StageStatus,
      detail?: string,
    ) => {
      if (!active) return;
      setView((current) => {
        const base = current.recordId === recordId && current.attempt === attempt
          ? current
          : {
              recordId,
              attempt,
              order: null,
              result: null,
              stages: createStages(),
            };
        return {
          ...base,
          stages: base.stages.map((stage) =>
            stage.id === id
              ? { ...stage, status, ...(detail ? { detail } : {}) }
              : stage,
          ),
        };
      });
    };

    async function verify() {
      let foundOrder: PublicOrderDetails;
      try {
        foundOrder = await api.getPublicOrder(recordId);
        if (!active) return;
        if (foundOrder.status !== "FOUND") {
          updateStage(1, "failed", "No public order mapping was found.");
          for (const id of [2, 3, 4]) updateStage(id, "skipped", "Not checked.");
          updateStage(5, "success", "Verification report prepared.");
          update({ result: fallbackResult("NOT_VERIFIED", "This purchase could not be found.", foundOrder) });
          return;
        }
        update({ order: foundOrder });
        updateStage(1, "success", "Order information retrieved.");
      } catch {
        if (!active) return;
        updateStage(1, "unavailable", "The order information service could not be reached.");
        for (const id of [2, 3, 4]) updateStage(id, "skipped", "Not checked.");
        updateStage(5, "success", "Verification report prepared.");
        update({ result: fallbackResult("UNAVAILABLE", "Verification is temporarily unavailable.") });
        return;
      }

      updateStage(2, "loading");
      try {
        const record = await api.getPublicRetailTraceRecord(recordId);
        if (!active) return;
        if (record.status === "UNAVAILABLE") {
          updateStage(2, "unavailable", "RetailTrace is temporarily unavailable.");
          for (const id of [3, 4]) updateStage(id, "skipped", "Not checked.");
          updateStage(5, "success", "Verification report prepared.");
          update({ result: fallbackResult("UNAVAILABLE", "Verification is temporarily unavailable.", foundOrder) });
          return;
        }
        if (record.status === "NOT_FOUND") {
          updateStage(2, "failed", "RetailTrace could not find this published record.");
          for (const id of [3, 4]) updateStage(id, "skipped", "Not checked.");
          updateStage(5, "success", "Verification report prepared.");
          update({ result: fallbackResult("NOT_VERIFIED", "The RetailTrace record could not be found.", foundOrder) });
          return;
        }
        if (!record.transactionId) {
          updateStage(2, "success", "RetailTrace record found; awaiting a transaction ID.");
          updateStage(3, "pending", "A transaction is not available yet.");
          updateStage(4, "pending", "Integrity check will run after publication.");
          updateStage(5, "success", "Verification report prepared.");
          update({
            result: fallbackResult(
              "PENDING",
              "The RetailTrace record is waiting for blockchain publication.",
              foundOrder,
            ),
          });
          return;
        }

        updateStage(2, "success", "RetailTrace record found.");
        updateStage(3, "loading");
        updateStage(4, "loading");
        const verification = await api.verifyPublicRecord(recordId);
        if (!active) return;
        update({ result: verification });

        const checks = verification.checks;
        updateStage(
          3,
          checks.transactionExists === true
            ? verification.publicationStatus === "PENDING"
              ? "pending"
              : verification.publicationStatus === "FAILED"
                ? "failed"
                : !verification.publicationStatus
                  ? "unavailable"
                  : "success"
            : checks.transactionExists === false ? "failed" : "unavailable",
          checks.transactionExists === true
            ? verification.publicationStatus === "PENDING"
              ? "Transaction found; awaiting blockchain confirmation."
              : verification.publicationStatus === "FAILED"
                ? "Transaction is not confirmed on the active blockchain."
                : !verification.publicationStatus
                  ? "Blockchain confirmation state could not be determined."
                  : "Blockchain transaction confirmed."
            : checks.transactionExists === false
              ? "The transaction was not found on the blockchain."
              : "The transaction check could not be completed.",
        );
        updateStage(
          4,
          checks.commitmentMatches === true
            ? "success"
            : checks.commitmentMatches === false
              ? "failed"
              : verification.status === "UNAVAILABLE"
                ? "unavailable"
                : verification.status === "PENDING"
                  ? "pending"
                  : checks.transactionExists === false || checks.recordFound === false
                    ? "failed"
                    : "unavailable",
          checks.commitmentMatches === true
            ? "Data integrity verified. The record matches its blockchain commitment."
            : checks.commitmentMatches === false
              ? "The record does not match the blockchain commitment."
              : verification.status === "PENDING"
                ? "Integrity check is waiting for transaction confirmation."
                : checks.transactionExists === false || checks.recordFound === false
                  ? "Integrity could not be verified because the transaction or record was not found."
                  : "Data integrity could not be checked.",
        );
        updateStage(5, "success", "Verification report prepared.");
      } catch {
        if (!active) return;
        updateStage(2, "unavailable", "RetailTrace could not be reached.");
        updateStage(3, "unavailable", "The blockchain transaction could not be checked.");
        updateStage(4, "unavailable", "Data integrity could not be checked.");
        updateStage(5, "success", "Verification report prepared.");
        update({ result: fallbackResult("UNAVAILABLE", "Verification is temporarily unavailable.", foundOrder) });
      }
    }

    void verify();
    return () => {
      active = false;
    };
  }, [recordId, attempt]);

  const loading = !isCurrentView || result === null;

  async function downloadReceipt() {
    if (!order || !result) return;
    setIsDownloading(true);
    setDownloadError("");
    try {
      const { createVerificationReceiptPdf } = await import("./receipt-pdf");
      const pdf = createVerificationReceiptPdf(order, result);
      const reference = order.orderReference?.toLowerCase() ?? recordId;
      pdf.save(`verdant-verification-${reference}.pdf`);
    } catch {
      setDownloadError("The PDF receipt could not be generated. Please use Print to save a copy.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function copyTransactionId() {
    const transactionId = result?.transactionId ?? order?.transactionId;
    if (!transactionId) return;
    try {
      await navigator.clipboard.writeText(transactionId);
      setCopyMessage("Transaction ID copied.");
    } catch {
      setCopyMessage("Copy is unavailable. Select the transaction ID in the details below.");
    }
  }

  return (
    <main className={`public-verification-page ${isReceiptView ? "is-receipt-view" : ""}`}>
      <header className="public-verification-header no-print">
        <Link to="/" className="public-verification-brand">
          <span><ShieldCheck size={19} /></span>
          <strong>verdant</strong>
        </Link>
        <span className="public-verification-branding">RETAILTRACE PUBLIC VERIFICATION</span>
      </header>

      <section className="public-verification-content" aria-live="polite">
        {!isReceiptView && (
          <div className="public-verification-heading">
            <p className="public-verification-eyebrow">CUSTOMER VERIFICATION</p>
            <h1>Verify this purchase</h1>
            <p>
              We check the purchase mapping, retrieve its RetailTrace record, and compare the
              blockchain commitment with the stored record.
            </p>
          </div>
        )}

        {!isReceiptView && (
          <section className="verification-progress no-print" aria-label="Verification progress">
            <ol>
              {stages.map((stage) => <VerificationStageView key={stage.id} stage={stage} />)}
            </ol>
          </section>
        )}

        {loading ? (
          <div role="status" className="public-verification-card verification-waiting">
            <span className="public-verification-icon is-loading">
              <LoaderCircle size={25} className="spin" />
            </span>
            <h2>Checking the blockchain record</h2>
            <p className="public-verification-message">
              {stages.find((stage) => stage.status === "loading")?.loadingText ?? "Preparing your verification report..."}
            </p>
          </div>
        ) : result && (
          <>
            <section className={`public-verification-card ${result.status === "VERIFIED" ? "is-verified" : ""} ${result.status === "PENDING" ? "is-pending" : ""}`}>
              <span className="public-verification-icon">
                {result.status === "VERIFIED" ? <CheckCircle2 size={26} /> : <AlertCircle size={25} />}
              </span>
              <p className="public-verification-eyebrow">{isReceiptView ? "VERIFICATION RECEIPT" : "FINAL RESULT"}</p>
              <h2>{publicVerificationTitle(result.status)}</h2>
              <p className="public-verification-message">{resultMessage(result)}</p>
              <p className="public-verification-caveat">
                Blockchain integrity confirms the published commitment matches the checked record.
                It does not prove that the original information was truthful or that a physical
                product is genuine.
              </p>
              <div className="public-verification-actions no-print">
                {(result.transactionId || order?.transactionId) && (
                  <button type="button" onClick={() => void copyTransactionId()} className="receipt-action is-secondary">
                    <Copy size={16} /> Copy transaction ID
                  </button>
                )}
                {isReceiptView ? (
                  <>
                    <button type="button" onClick={() => void downloadReceipt()} disabled={isDownloading} className="receipt-action">
                      {isDownloading ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
                      {isDownloading ? "Preparing PDF..." : "Download PDF"}
                    </button>
                    <button type="button" onClick={() => window.print()} className="receipt-action is-secondary">
                      <Printer size={16} /> Print
                    </button>
                    <Link to={`/verify/${encodeURIComponent(recordId)}`} className="receipt-action is-secondary">
                      <ArrowLeft size={16} /> Back to verification
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to={`/verify/${encodeURIComponent(recordId)}/receipt`} className="receipt-action">
                      View receipt
                    </Link>
                    {result.status !== "VERIFIED" && (
                      <button type="button" onClick={() => setAttempt((value) => value + 1)} className="receipt-action is-secondary">
                        Check again
                      </button>
                    )}
                  </>
                )}
              </div>
              {downloadError && <p role="alert" className="receipt-download-error no-print">{downloadError}</p>}
              {copyMessage && <p role="status" className="receipt-copy-message no-print">{copyMessage}</p>}
            </section>

            {order && (
              <section className="public-verification-details verification-receipt">
                <div className="verification-section-heading">
                  <p className="public-verification-eyebrow">VERDANT · RETAILTRACE</p>
                  <h2>{result.status === "VERIFIED" ? "Your Verified Purchase" : "Purchase verification details"}</h2>
                </div>
                <dl className="verification-info-grid">
                  <VerificationDetail
                    label="Order reference"
                    value={order.orderReference ?? "Not available"}
                    description="Verdant's identifier for this purchase."
                  />
                  <VerificationDetail label="Order date" value={formatDate(order.orderDate)} />
                  <VerificationDetail label="Order total" value={order.total ?? "Not available"} description="Currency was not supplied by the store." />
                  <VerificationDetail
                    label="RetailTrace record ID"
                    value={result.recordId ?? order.retailTraceRecordId ?? "Not available"}
                    mono
                    description="Identifies the record submitted to RetailTrace."
                  />
                  <VerificationDetail
                    label="Blockchain transaction ID"
                    value={result.transactionId ?? order.transactionId ?? "Not available"}
                    mono
                    description="Identifies the blockchain publication transaction."
                  />
                  <VerificationDetail label="Publication status" value={result.publicationStatus ?? order.publicationStatus ?? "Not available"} />
                  <VerificationDetail label="Publication timestamp" value={formatDate(result.publicationTimestamp)} />
                  <VerificationDetail label="Verification timestamp" value={formatDate(result.verificationTimestamp)} />
                  <VerificationDetail
                    label="Data integrity"
                    value={result.checks.commitmentMatches === null
                      ? "Unable to check"
                      : result.checks.commitmentMatches
                        ? "Commitment matches"
                        : "Commitment does not match"}
                  />
                  {result.network && <VerificationDetail label="Blockchain network" value={result.network} />}
                  {result.confirmations !== undefined && <VerificationDetail label="Confirmations" value={String(result.confirmations)} />}
                  {result.blockHeight !== undefined && <VerificationDetail label="Block height" value={String(result.blockHeight)} />}
                  {result.commitmentHash && (
                    <VerificationDetail
                      label="Cryptographic commitment"
                      value={result.commitmentHash}
                      mono
                      description="A data fingerprint; the underlying order data is not included in the hash display."
                    />
                  )}
                </dl>

                <div className="verification-products">
                  <h3>Products</h3>
                  <ul>
                    {(order.products ?? []).map((product, index) => (
                      <li key={`${product.name}-${index}`}>
                        <span>{product.name}</span><strong>× {product.quantity}</strong>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="verification-checks">
                  <h3>What was checked</h3>
                  <CheckSummary label="Blockchain transaction found" value={result.checks.transactionExists} />
                  <CheckSummary label="RetailTrace record found" value={result.checks.recordFound} />
                  <CheckSummary label="Record commitment matches" value={result.checks.commitmentMatches} />
                </div>

                {result.transactionId && (
                  <div className="independent-verification no-print">
                    <h3>Want to verify this record yourself?</h3>
                    <p>
                      You can also visit RetailTrace and independently check this blockchain
                      transaction using its transaction ID. No RetailTrace account is required.
                    </p>
                    {result.independentVerificationUrl ? (
                      <a href={result.independentVerificationUrl} target="_blank" rel="noreferrer">
                        Verify independently on RetailTrace <ExternalLink size={15} />
                      </a>
                    ) : (
                      <p className="independent-link-unavailable">
                        <a href="https://retail-trace.vercel.app/">Visit RetailTrace</a>
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function VerificationStageView({ stage }: { stage: VerificationStage }) {
  const icon = stage.status === "success"
    ? <Check size={17} />
    : stage.status === "loading"
      ? <LoaderCircle size={17} className="spin" />
      : stage.status === "failed" || stage.status === "unavailable"
        ? <AlertCircle size={17} />
        : <Circle size={17} />;
  const message = stage.detail ?? (
    stage.status === "loading"
      ? stage.loadingText
      : stage.status === "waiting"
        ? "Waiting"
        : stage.status === "pending"
          ? "Awaiting confirmation"
          : stage.status === "skipped"
            ? "Not checked"
            : stage.status === "unavailable"
              ? "Temporarily unavailable"
              : stage.status === "failed"
                ? "Check failed"
                : "Complete"
  );
  return (
    <li className={`verification-stage is-${stage.status}`}>
      <span className="verification-stage-icon">{icon}</span>
      <div>
        <strong>{stage.title}</strong>
        <span>{message}</span>
      </div>
    </li>
  );
}

function VerificationDetail({
  label,
  value,
  mono = false,
  description,
}: {
  label: string;
  value: string;
  mono?: boolean;
  description?: string;
}) {
  return (
    <div className="verification-detail">
      <dt>{label}</dt>
      <dd className={mono ? "is-mono" : ""}>{value}</dd>
      {description && <p>{description}</p>}
    </div>
  );
}

function CheckSummary({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className={`verification-check is-${value === null ? "unknown" : value ? "success" : "failure"}`}>
      <span>{value === null ? "Not checked" : value ? "Confirmed" : "Not confirmed"}</span>
      <strong>{label}</strong>
    </div>
  );
}
