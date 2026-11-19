import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import {
  api,
  type PublicVerificationResult,
} from "./services/api";
import "./PublicVerificationPage.css";

type VerificationState =
  | { recordId: string; attempt: number; kind: "loading" }
  | {
      recordId: string;
      attempt: number;
      kind: "result";
      result: PublicVerificationResult;
    };

export default function PublicVerificationPage() {
  const { recordId = "" } = useParams();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<VerificationState>({
    recordId: "",
    attempt: 0,
    kind: "loading",
  });

  useEffect(() => {
    let active = true;
    void api.verifyPublicRecord(recordId)
      .then((result) => {
        if (active) setState({ recordId, attempt, kind: "result", result });
      })
      .catch(() => {
        if (active) {
          setState({
            recordId,
            attempt,
            kind: "result",
            result: { status: "UNAVAILABLE" },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [recordId, attempt]);

  const isLoading =
    state.recordId !== recordId ||
    state.attempt !== attempt ||
    state.kind === "loading";
  const result = !isLoading && state.kind === "result" ? state.result : null;
  const status = result?.status;
  const title = status === "VERIFIED"
    ? "Blockchain record verified"
    : status === "PENDING"
      ? "Publication is still pending"
      : status === "UNAVAILABLE"
        ? "Verification temporarily unavailable"
        : "Record not verified";
  const message = status === "VERIFIED"
    ? "Blockchain record confirmed. This order's stored record matches its blockchain commitment."
    : status === "PENDING"
      ? "This order's record has not finished publishing. Please check again shortly."
      : status === "UNAVAILABLE"
        ? "Verification is temporarily unavailable. Please try again later."
        : "We could not verify this order's blockchain record.";
  const isPositive = status === "VERIFIED";
  const isPending = status === "PENDING";

  return (
    <main className="public-verification-page">
      <header className="public-verification-header">
        <Link to="/" className="public-verification-brand">
          <span><ShieldCheck size={19} /></span>
          <strong>verdant</strong>
        </Link>
      </header>
      <section
        className={`public-verification-card ${isPositive ? "is-verified" : ""} ${isPending ? "is-pending" : ""}`}
        aria-live="polite"
      >
        {isLoading ? (
          <>
            <span className="public-verification-icon is-loading">
              <LoaderCircle size={25} className="spin" />
            </span>
            <p className="public-verification-eyebrow">PUBLIC RECORD CHECK</p>
            <h1>Checking blockchain record</h1>
            <p className="public-verification-message">Contacting Verdant's verification service...</p>
          </>
        ) : (
          <>
            <span className="public-verification-icon">
              {isPositive
                ? <Check size={26} />
                : isPending
                  ? <LoaderCircle size={24} className="spin" />
                  : <AlertCircle size={25} />}
            </span>
            <p className="public-verification-eyebrow">PUBLIC RECORD CHECK</p>
            <h1>{title}</h1>
            <p className="public-verification-message">{message}</p>
            {result?.orderReference && (
              <div className="public-verification-detail">
                <span>Order reference</span>
                <code>{result.orderReference}</code>
              </div>
            )}
            {result?.publicationStatus && (
              <div className="public-verification-detail">
                <span>RetailTrace publication</span>
                <code>{result.publicationStatus}</code>
              </div>
            )}
            {result?.transactionId && (
              <div className="public-verification-detail">
                <span>Blockchain transaction</span>
                <code>{result.transactionId}</code>
              </div>
            )}
            {status !== "VERIFIED" && (
              <button
                type="button"
                className="public-verification-retry"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Check again
              </button>
            )}
          </>
        )}
        <p className="public-verification-explanation">
          Verdant asked RetailTrace to verify the order record against its blockchain commitment.
          No customer details are shown on this page.
        </p>
        <Link to="/" className="public-verification-back">
          <ArrowLeft size={15} /> Return to Verdant Store
        </Link>
      </section>
    </main>
  );
}
