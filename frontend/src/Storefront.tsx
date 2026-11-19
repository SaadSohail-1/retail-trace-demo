import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Copy, LoaderCircle, ShoppingBag, ShieldCheck, Sprout, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  api,
  getErrorMessage,
  type OrderView,
  type ProductView,
  type SyncResult,
  type VerificationResult,
} from "./services/api";
import "./Storefront.css";

function publicationStatus(sync: SyncResult | null): string {
  if (!sync) return "Not synchronized";
  if (sync.retailTraceStatus === "CONFIRMED") {
    return sync.transactionId ? "Blockchain confirmed" : "Confirmation details unavailable";
  }
  if (sync.retailTraceStatus === "FAILED") return "Publication failed";
  if (sync.retailTraceStatus === "PENDING") return "Awaiting blockchain confirmation";
  if (sync.submissionUncertain) return "Publication outcome unknown";
  if (sync.syncStatus === "FAILED") return "Publication failed";
  if (sync.syncStatus === "PENDING" && !sync.retailTraceRecordId) {
    return "Awaiting publication";
  }
  return "Blockchain status unknown";
}

function transactionDisplay(sync: SyncResult | null): string {
  if (sync?.transactionId) return sync.transactionId;
  if (sync?.retailTraceStatus === "PENDING") {
    return "Awaiting blockchain confirmation";
  }
  if (sync?.submissionUncertain) return "Publication outcome unknown";
  if (sync?.retailTraceStatus === "FAILED" || sync?.syncStatus === "FAILED") {
    return "Unavailable — publication failed";
  }
  if (sync?.syncStatus === "PENDING") return "Awaiting publication";
  return "Not available";
}

type Toast = {
  id: number;
  kind: "success" | "warning" | "error";
  message: string;
};

type ReceiptVerification =
  | { status: "loading" }
  | { status: "complete"; result: VerificationResult }
  | { status: "error"; message: string };

const productImages = [
  "https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1611930022073-b7a4ba5fcccd?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1526947425960-945c6e72858f?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=900&q=80",
];

export default function Storefront() {
  const [products, setProducts] = useState<ProductView[]>([]);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [selected, setSelected] = useState<ProductView | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [completed, setCompleted] = useState<OrderView | null>(null);
  const [verificationByOrderId, setVerificationByOrderId] = useState<
    Record<string, ReceiptVerification>
  >({});
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null);
  const [successTab, setSuccessTab] = useState<"receipt" | "verify">("receipt");
  const [transactionInput, setTransactionInput] = useState("");
  const [transactionVerification, setTransactionVerification] = useState<VerificationResult | null>(null);
  const [transactionVerifying, setTransactionVerifying] = useState(false);
  const toastTimeout = useRef<number | null>(null);

  const notify = useCallback((kind: Toast["kind"], message: string) => {
    if (toastTimeout.current !== null) window.clearTimeout(toastTimeout.current);
    const id = Date.now();
    setToast({ id, kind, message });
    toastTimeout.current = window.setTimeout(() => {
      setToast((current) => current?.id === id ? null : current);
      toastTimeout.current = null;
    }, 5000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [productResult, orderResult] = await Promise.all([
        api.getProducts(),
        api.getOrders(),
      ]);
      setProducts(productResult);
      setOrders(orderResult);
      setCompleted((current) => current
        ? orderResult.find(({ order }) => order.id === current.order.id) ?? current
        : current);
    } catch (refreshError) {
      notify("error", getErrorMessage(refreshError));
    }
  }, [notify]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  useEffect(() => () => {
    if (toastTimeout.current !== null) window.clearTimeout(toastTimeout.current);
  }, []);

  const completedVerification = completed
    ? verificationByOrderId[completed.order.id]
    : undefined;

  async function placeOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !customerName.trim()) return;
    setBusy(true);
    try {
      const created = await api.createOrder(customerName.trim(), selected.product.id);
      let order = created;
      let latestStatusRefreshError = "";
      try {
        order = await api.getOrder(created.order.id);
      } catch (latestError) {
        latestStatusRefreshError = getErrorMessage(latestError);
      }
      setCompleted(order);
      setSuccessTab("receipt");
      setTransactionVerification(null);
      setTransactionInput(order.synchronization?.transactionId ?? "");
      setSelected(null);
      setCustomerName("");
      const sync = order.synchronization;
      const refreshWarning = latestStatusRefreshError
        ? ` Latest status refresh failed: ${latestStatusRefreshError}`
        : "";
      if (sync?.retailTraceStatus === "CONFIRMED") {
        notify(
          sync.transactionId && !latestStatusRefreshError ? "success" : "warning",
          `Order placed.${sync.transactionId ? " Blockchain publication confirmed." : " RetailTrace reports confirmation, but the transaction ID is unavailable."}${refreshWarning}`,
        );
      } else if (
        sync?.retailTraceStatus === "FAILED" ||
        sync?.syncStatus === "FAILED"
      ) {
        notify(
          "error",
          `Order saved, but RetailTrace publication failed${sync.errorMessage ? `: ${sync.errorMessage}` : "."}${refreshWarning}`,
        );
      } else if (sync?.retailTraceStatus === "PENDING") {
        notify("warning", `Order saved. Awaiting blockchain confirmation.${refreshWarning}`);
      } else if (sync?.submissionUncertain) {
        notify(
          "warning",
          `Order saved. RetailTrace submission outcome is unknown; no new submission was made.${refreshWarning}`,
        );
      } else if (sync?.syncStatus === "PENDING") {
        notify("warning", `Order saved. Awaiting RetailTrace publication.${refreshWarning}`);
      } else {
        notify("warning", `Order saved. RetailTrace publication status is not yet confirmed.${refreshWarning}`);
      }
      await refresh();
    } catch (orderError) {
      notify("error", getErrorMessage(orderError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOrder(order: OrderView) {
    const orderId = order.order.id;
    if (verifyingOrderId !== null) return;
    setVerifyingOrderId(orderId);
    setVerificationByOrderId((current) => ({
      ...current,
      [orderId]: { status: "loading" },
    }));
    try {
      const recordId = order.synchronization?.retailTraceRecordId;
      const transactionId = order.synchronization?.transactionId;
      let result: VerificationResult;
      if (recordId) {
        result = await api.verify(recordId);
        if (result.recordId !== recordId) {
          throw new Error("RetailTrace returned a verification result for a different record.");
        }
      } else if (transactionId) {
        result = await api.verifyByTransaction(transactionId);
        if (result.transactionId && result.transactionId !== transactionId) {
          throw new Error("RetailTrace returned a verification result for a different transaction.");
        }
      } else {
        throw new Error("This order has no RetailTrace record or transaction ID to verify.");
      }
      setVerificationByOrderId((current) => ({
        ...current,
        [orderId]: { status: "complete", result },
      }));
      notify(
        result.verified ? "success" : "warning",
        result.verified
          ? "RetailTrace verified this order record."
          : "RetailTrace could not verify this order record.",
      );
    } catch (verifyError) {
      const message = getErrorMessage(verifyError);
      setVerificationByOrderId((current) => ({
        ...current,
        [orderId]: { status: "error", message },
      }));
      notify("error", message);
    } finally {
      setVerifyingOrderId((current) => current === orderId ? null : current);
    }
  }

  async function verifyTransaction(event: React.FormEvent) {
    event.preventDefault();
    const transactionId = transactionInput.trim();
    if (!transactionId) {
      notify("warning", "Enter a transaction ID to verify.");
      return;
    }
    setTransactionVerifying(true);
    setTransactionVerification(null);
    try {
      const result = await api.verifyByTransaction(transactionId);
      if (result.transactionId && result.transactionId !== transactionId) {
        throw new Error("RetailTrace returned a verification result for a different transaction.");
      }
      setTransactionVerification(result);
      notify(
        result.verified ? "success" : "warning",
        result.verified
          ? "RetailTrace verified this transaction."
          : "RetailTrace could not verify this transaction.",
      );
    } catch (verifyError) {
      notify("error", getErrorMessage(verifyError));
    } finally {
      setTransactionVerifying(false);
    }
  }

  async function copyTransactionId(transactionId: string) {
    try {
      await navigator.clipboard.writeText(transactionId);
      notify("success", "Transaction ID copied.");
    } catch {
      notify("error", "Could not copy the transaction ID. Select and copy it manually.");
    }
  }

  return (
    <div className="storefront">
      <header className="store-header">
        <a className="store-brand" href="/" aria-label="Verdant Store">
          <span><Sprout size={21} /></span>
          <strong>verdant</strong>
        </a>
        <nav>
          <a href="#shop">Shop</a>
          <a href="#orders">My orders</a>
          <a className="admin-link" href="/admin">Admin portal</a>
        </nav>
      </header>

      <main>
        <section className="store-hero" id="shop">
          <div>
            <p>Plant-powered essentials</p>
            <h1>Good products.<br /><em>Clear provenance.</em></h1>
            <span>Orders are submitted to RetailTrace; publication status stays visible.</span>
          </div>
          <div className="hero-badge"><ShieldCheck size={21} /> Blockchain verified</div>
        </section>

        <section className="product-section">
          <div className="section-heading">
            <div><p>THE COLLECTION</p><h2>Daily botanical care</h2></div>
            <span>{products.length} traceable products</span>
          </div>
          <div className="product-grid">
            {products.map((item, index) => (
              <article className="product-card" key={item.product.id}>
                <div className="product-image">
                  <img src={productImages[index % productImages.length]} alt={item.product.name} />
                  {item.synchronization && (
                    <span className="trace-badge">
                      {item.synchronization.retailTraceStatus === "CONFIRMED" && item.synchronization.transactionId && <Check size={12} />}
                      {publicationStatus(item.synchronization)}
                    </span>
                  )}
                </div>
                <div className="product-info">
                  <p>{item.supplier.country}</p>
                  <h3>{item.product.name}</h3>
                  <div className="product-buy">
                    <strong>${Number(item.product.price).toFixed(2)}</strong>
                    <button onClick={() => setSelected(item)} disabled={item.product.stockQuantity < 1}>
                      <ShoppingBag size={15} /> Order
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="orders-section" id="orders">
          <div className="section-heading">
            <div><p>YOUR RECEIPTS</p><h2>Orders & blockchain checks</h2></div>
          </div>
          {orders.length === 0 ? (
            <p className="no-orders">Place an order to create a local and RetailTrace record.</p>
          ) : (
            <div className="order-list">
              {orders.map((order) => {
                const receiptVerification = verificationByOrderId[order.order.id];
                return (
                  <article className="order-row" key={order.order.id}>
                    <div>
                      <strong>{order.order.customerName}</strong>
                      <span>Order {order.order.id}</span>
                    </div>
                    <div><span>Order ID</span><code>{order.order.id}</code></div>
                    <div>
                      <span>Blockchain status</span>
                      <code>{publicationStatus(order.synchronization)}</code>
                    </div>
                    <div>
                      <span>Transaction ID</span>
                      <code>{transactionDisplay(order.synchronization)}</code>
                    </div>
                    <strong>${Number(order.order.total).toFixed(2)}</strong>
                    <button
                      onClick={() => void verifyOrder(order)}
                      disabled={verifyingOrderId !== null}
                    >
                      {verifyingOrderId === order.order.id
                        ? <><LoaderCircle size={15} className="spin" /> Checking</>
                        : <><ShieldCheck size={15} /> Verify</>}
                    </button>
                    {receiptVerification && (
                      <div
                        className={`receipt-verification ${receiptVerification.status === "complete" && receiptVerification.result.verified ? "is-verified" : receiptVerification.status === "error" || receiptVerification.status === "complete" ? "is-unverified" : ""}`}
                        role={receiptVerification.status === "error" ? "alert" : "status"}
                      >
                        {receiptVerification.status === "loading" ? (
                          <><LoaderCircle size={15} className="spin" /><span>Checking RetailTrace...</span></>
                        ) : receiptVerification.status === "error" ? (
                          <><CircleAlert size={15} /><span>{receiptVerification.message}</span></>
                        ) : (
                          <>
                            {receiptVerification.result.verified
                              ? <Check size={15} />
                              : <CircleAlert size={15} />}
                            <span>
                              <strong>{receiptVerification.result.verified ? "Verified — record hash matches" : "Not verified — hash match could not be confirmed"}</strong>
                              <small>
                                {receiptVerification.result.verified
                                  ? "RetailTrace confirmed the record against the blockchain."
                                  : "The record may be missing, pending, or have a hash mismatch."}
                              </small>
                              <code>
                                Transaction ID: {receiptVerification.result.transactionId ?? order.synchronization?.transactionId ?? "Not available"}
                              </code>
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {selected && (
        <div className="order-modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <form className="order-modal" onSubmit={placeOrder} onMouseDown={(event) => event.stopPropagation()}>
            <p>PLACE AN ORDER</p>
            <h2>{selected.product.name}</h2>
            <label>
              Customer name
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Enter your name" required autoFocus />
            </label>
            <div className="modal-total"><span>Total</span><strong>${Number(selected.product.price).toFixed(2)}</strong></div>
            <button type="submit" disabled={busy}>{busy ? "Creating order..." : "Place order"}</button>
          </form>
        </div>
      )}

      {toast && (
        <div
          key={toast.id}
          className={`store-toast toast-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
          aria-live={toast.kind === "error" ? "assertive" : "polite"}
        >
          {toast.kind === "success" ? <Check size={17} /> : <CircleAlert size={17} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      )}

      {completed && (
        <div className="order-modal-backdrop" role="presentation" onMouseDown={() => setCompleted(null)}>
          <div className="order-modal success-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="success-icon"><Check size={24} /></span>
            <p>ORDER SAVED</p>
            <h2>Thank you, {completed.order.customerName}</h2>
            <label>
              RetailTrace status
              <code>{publicationStatus(completed.synchronization)}</code>
            </label>
            <div className="success-tabs" role="tablist" aria-label="Order confirmation options">
              <button
                type="button"
                className={successTab === "receipt" ? "active" : ""}
                onClick={() => setSuccessTab("receipt")}
                role="tab"
                aria-selected={successTab === "receipt"}
              >
                Receipt
              </button>
              <button
                type="button"
                className={successTab === "verify" ? "active" : ""}
                onClick={() => setSuccessTab("verify")}
                role="tab"
                aria-selected={successTab === "verify"}
              >
                Verify transaction
              </button>
            </div>

            {successTab === "receipt" ? (
              <>
                <label>Order ID<code>{completed.order.id}</code></label>
                <label>Transaction ID<code>{transactionDisplay(completed.synchronization)}</code></label>
                {completed.synchronization?.transactionId && (
                  <button
                    type="button"
                    className="copy-transaction"
                    onClick={() => {
                      const transactionId = completed.synchronization?.transactionId;
                      if (transactionId) void copyTransactionId(transactionId);
                    }}
                    aria-label="Copy blockchain transaction ID"
                  >
                    <Copy size={14} /> Copy transaction ID
                  </button>
                )}
                {completed.synchronization?.syncStatus === "SYNCED" &&
                  completed.synchronization.retailTraceStatus === "CONFIRMED" &&
                  completed.synchronization.retailTraceRecordId &&
                  completed.synchronization.transactionId &&
                  (completed.verificationUrl ? (
                    <div className="order-verification-qr">
                      <QRCodeSVG value={completed.verificationUrl} size={156} level="M" includeMargin />
                      <strong>Scan to verify this order on the blockchain.</strong>
                      <a href={completed.verificationUrl}>Open public verification page</a>
                    </div>
                  ) : (
                    <p className="order-verification-link-missing">
                      A public verification link is not configured for this store.
                    </p>
                  ))}
                {completedVerification?.status === "complete" && (
                  <>
                    <label>Blockchain verification<code>{completedVerification.result.verified ? "Verified — record hash matches" : "Not verified — hash match could not be confirmed"}</code></label>
                    <label>Verified transaction<code>{completedVerification.result.transactionId ?? completed.synchronization?.transactionId ?? "Not available"}</code></label>
                  </>
                )}
                {completedVerification?.status === "error" && (
                  <div className="receipt-verification is-unverified" role="alert">
                    <CircleAlert size={15} /><span>{completedVerification.message}</span>
                  </div>
                )}
                <button type="button" onClick={() => setSuccessTab("verify")}>Verify on blockchain</button>
              </>
            ) : (
              <form className="transaction-verifier" onSubmit={verifyTransaction}>
                <label htmlFor="transaction-id">
                  Transaction ID
                  <input
                    id="transaction-id"
                    value={transactionInput}
                    onChange={(event) => setTransactionInput(event.target.value)}
                    placeholder="Enter the complete transaction ID"
                    autoComplete="off"
                  />
                </label>
                <button type="submit" disabled={transactionVerifying}>
                  {transactionVerifying ? "Checking blockchain..." : "Check transaction"}
                </button>
                {transactionVerification && (
                  <div className={`transaction-result ${transactionVerification.verified ? "verified" : "not-verified"}`}>
                    <ShieldCheck size={18} />
                    <div>
                      <strong>{transactionVerification.verified ? "Transaction verified" : "Transaction not verified"}</strong>
                      <span>{transactionVerification.verified ? "Record hash matches the blockchain commitment." : "Hash match could not be confirmed; the record may be missing, pending, or mismatched."}</span>
                      <code>Record ID: {transactionVerification.recordId}</code>
                      <code>{transactionVerification.transactionId ?? transactionInput}</code>
                    </div>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
