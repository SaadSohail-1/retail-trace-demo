import { useEffect, useState } from "react";
import { Check, ShoppingBag, ShieldCheck, Sprout } from "lucide-react";
import { api, getErrorMessage, type OrderView, type ProductView, type VerificationResult } from "./services/api";
import "./Storefront.css";

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
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<OrderView | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [successTab, setSuccessTab] = useState<"receipt" | "verify">("receipt");
  const [transactionInput, setTransactionInput] = useState("");
  const [transactionVerification, setTransactionVerification] = useState<VerificationResult | null>(null);
  const [transactionVerifying, setTransactionVerifying] = useState(false);

  async function refresh() {
    try {
      const [productResult, orderResult] = await Promise.all([
        api.getProducts(),
        api.getOrders(),
      ]);
      setProducts(productResult);
      setOrders(orderResult);
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function placeOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !customerName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const order = await api.createOrder(customerName.trim(), selected.product.id);
      setCompleted(order);
      setSuccessTab("receipt");
      setVerification(null);
      setTransactionVerification(null);
      setTransactionInput(order.synchronization?.transactionId ?? "");
      setSelected(null);
      setCustomerName("");
      await refresh();
    } catch (orderError) {
      setError(getErrorMessage(orderError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOrder(order: OrderView) {
    const recordId = order.synchronization?.retailTraceRecordId;
    if (!recordId) {
      setError("This order has not been synchronized to RetailTrace yet.");
      return;
    }
    try {
      setVerification(await api.verify(recordId));
    } catch (verifyError) {
      setError(getErrorMessage(verifyError));
    }
  }

  async function verifyTransaction(event: React.FormEvent) {
    event.preventDefault();
    const transactionId = transactionInput.trim();
    if (!transactionId) {
      setError("Enter a transaction ID to verify.");
      return;
    }
    setTransactionVerifying(true);
    setError("");
    setTransactionVerification(null);
    try {
      setTransactionVerification(await api.verifyByTransaction(transactionId));
    } catch (verifyError) {
      setError(getErrorMessage(verifyError));
    } finally {
      setTransactionVerifying(false);
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
            <span>Every purchase is recorded in RetailTrace.</span>
          </div>
          <div className="hero-badge"><ShieldCheck size={21} /> Blockchain verified</div>
        </section>

        {error && <div className="store-error" role="alert">{error}</div>}

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
                  {item.synchronization?.syncStatus === "SYNCED" && (
                    <span className="trace-badge"><Check size={12} /> RetailTrace</span>
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
              {orders.map((order) => (
                <article className="order-row" key={order.order.id}>
                  <div>
                    <strong>{order.order.customerName}</strong>
                    <span>Order {order.order.id}</span>
                  </div>
                  <div><span>Order ID</span><code>{order.order.id}</code></div>
                  <div><span>Transaction ID</span><code>{order.synchronization?.transactionId ?? "Pending"}</code></div>
                  <strong>${Number(order.order.total).toFixed(2)}</strong>
                  <button onClick={() => void verifyOrder(order)}>
                    <ShieldCheck size={15} /> Verify
                  </button>
                </article>
              ))}
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

      {completed && (
        <div className="order-modal-backdrop" role="presentation" onMouseDown={() => setCompleted(null)}>
          <div className="order-modal success-modal" onMouseDown={(event) => event.stopPropagation()}>
            <span className="success-icon"><Check size={24} /></span>
            <p>ORDER CONFIRMED</p>
            <h2>Thank you, {completed.order.customerName}</h2>
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
                <label>Transaction ID<code>{completed.synchronization?.transactionId ?? "Sync pending"}</code></label>
                {verification && <label>Blockchain<code>{verification.verified ? "Verified" : "Not verified"}</code></label>}
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
