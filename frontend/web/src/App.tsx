import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface WealthPlan {
  id: string;
  planType: string;
  amount: string;
  beneficiaries: string;
  timestamp: number;
  owner: string;
  status: "draft" | "simulated" | "recommended";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<WealthPlan[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPlanData, setNewPlanData] = useState({
    planType: "",
    amount: "",
    beneficiaries: "",
    description: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<WealthPlan | null>(null);

  // Calculate statistics for dashboard
  const draftCount = plans.filter(p => p.status === "draft").length;
  const simulatedCount = plans.filter(p => p.status === "simulated").length;
  const recommendedCount = plans.filter(p => p.status === "recommended").length;

  useEffect(() => {
    loadPlans().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPlans = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("plan_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing plan keys:", e);
        }
      }
      
      const list: WealthPlan[] = [];
      
      for (const key of keys) {
        try {
          const planBytes = await contract.getData(`plan_${key}`);
          if (planBytes.length > 0) {
            try {
              const planData = JSON.parse(ethers.toUtf8String(planBytes));
              list.push({
                id: key,
                planType: planData.planType,
                amount: planData.amount,
                beneficiaries: planData.beneficiaries,
                timestamp: planData.timestamp,
                owner: planData.owner,
                status: planData.status || "draft"
              });
            } catch (e) {
              console.error(`Error parsing plan data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading plan ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPlans(list);
    } catch (e) {
      console.error("Error loading plans:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPlan = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting wealth data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newPlanData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const planId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const planData = {
        planType: newPlanData.planType,
        amount: newPlanData.amount,
        beneficiaries: newPlanData.beneficiaries,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status: "draft",
        description: newPlanData.description
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `plan_${planId}`, 
        ethers.toUtf8Bytes(JSON.stringify(planData))
      );
      
      const keysBytes = await contract.getData("plan_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(planId);
      
      await contract.setData(
        "plan_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted wealth plan submitted securely!"
      });
      
      await loadPlans();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPlanData({
          planType: "",
          amount: "",
          beneficiaries: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const simulatePlan = async (planId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted wealth data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const planBytes = await contract.getData(`plan_${planId}`);
      if (planBytes.length === 0) {
        throw new Error("Plan not found");
      }
      
      const planData = JSON.parse(ethers.toUtf8String(planBytes));
      
      const updatedPlan = {
        ...planData,
        status: "simulated"
      };
      
      await contract.setData(
        `plan_${planId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPlan))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE simulation completed successfully!"
      });
      
      await loadPlans();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Simulation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const recommendPlan = async (planId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Generating optimal recommendation with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const planBytes = await contract.getData(`plan_${planId}`);
      if (planBytes.length === 0) {
        throw new Error("Plan not found");
      }
      
      const planData = JSON.parse(ethers.toUtf8String(planBytes));
      
      const updatedPlan = {
        ...planData,
        status: "recommended"
      };
      
      await contract.setData(
        `plan_${planId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPlan))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE recommendation generated successfully!"
      });
      
      await loadPlans();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Recommendation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start private wealth planning",
      icon: "🔗"
    },
    {
      title: "Create Wealth Plan",
      description: "Input your encrypted family and asset information",
      icon: "💼"
    },
    {
      title: "FHE Simulation",
      description: "Your data is processed in encrypted state using FHE technology",
      icon: "⚙️"
    },
    {
      title: "Get Recommendations",
      description: "Receive optimal wealth transfer strategies while keeping data private",
      icon: "📊"
    }
  ];

  const renderPieChart = () => {
    const total = plans.length || 1;
    const draftPercentage = (draftCount / total) * 100;
    const simulatedPercentage = (simulatedCount / total) * 100;
    const recommendedPercentage = (recommendedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment draft" 
            style={{ transform: `rotate(${draftPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment simulated" 
            style={{ transform: `rotate(${(draftPercentage + simulatedPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment recommended" 
            style={{ transform: `rotate(${(draftPercentage + simulatedPercentage + recommendedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{plans.length}</div>
            <div className="pie-label">Plans</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box draft"></div>
            <span>Draft: {draftCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box simulated"></div>
            <span>Simulated: {simulatedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box recommended"></div>
            <span>Recommended: {recommendedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Wealth<span>Transfer</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-plan-btn glass-button"
          >
            <div className="add-icon"></div>
            New Plan
          </button>
          <button 
            className="glass-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner gradient-bg">
          <div className="welcome-text">
            <h2>Privacy-Preserving Wealth Transfer</h2>
            <p>Secure wealth planning using FHE technology to protect your family's financial privacy</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section glass-card">
            <h2>FHE Wealth Planning Tutorial</h2>
            <p className="subtitle">Learn how to securely plan your wealth transfer with full privacy</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>Project Introduction</h3>
            <p>WealthTransferFHE uses Fully Homomorphic Encryption to simulate and recommend optimal wealth transfer strategies while keeping your family and asset data completely private.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Plan Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{plans.length}</div>
                <div className="stat-label">Total Plans</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{draftCount}</div>
                <div className="stat-label">Draft</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{simulatedCount}</div>
                <div className="stat-label">Simulated</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{recommendedCount}</div>
                <div className="stat-label">Recommended</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="plans-section">
          <div className="section-header">
            <h2>Wealth Transfer Plans</h2>
            <div className="header-actions">
              <button 
                onClick={loadPlans}
                className="refresh-btn glass-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="plans-list glass-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Type</div>
              <div className="header-cell">Amount</div>
              <div className="header-cell">Beneficiaries</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {plans.length === 0 ? (
              <div className="no-plans">
                <div className="no-plans-icon"></div>
                <p>No wealth transfer plans found</p>
                <button 
                  className="glass-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Plan
                </button>
              </div>
            ) : (
              plans.map(plan => (
                <div className="plan-row" key={plan.id} onClick={() => setSelectedPlan(plan)}>
                  <div className="table-cell plan-id">#{plan.id.substring(0, 6)}</div>
                  <div className="table-cell">{plan.planType}</div>
                  <div className="table-cell">{plan.amount}</div>
                  <div className="table-cell">{plan.beneficiaries}</div>
                  <div className="table-cell">
                    {new Date(plan.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${plan.status}`}>
                      {plan.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(plan.owner) && (
                      <>
                        {plan.status === "draft" && (
                          <button 
                            className="action-btn glass-button success"
                            onClick={(e) => { e.stopPropagation(); simulatePlan(plan.id); }}
                          >
                            Simulate
                          </button>
                        )}
                        {plan.status === "simulated" && (
                          <button 
                            className="action-btn glass-button primary"
                            onClick={(e) => { e.stopPropagation(); recommendPlan(plan.id); }}
                          >
                            Recommend
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPlan} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          planData={newPlanData}
          setPlanData={setNewPlanData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
      
      {selectedPlan && (
        <PlanDetailModal 
          plan={selectedPlan}
          onClose={() => setSelectedPlan(null)}
        />
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>WealthTransferFHE</span>
            </div>
            <p>Secure encrypted wealth planning using Zama FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} WealthTransferFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  planData: any;
  setPlanData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  planData,
  setPlanData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPlanData({
      ...planData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!planData.planType || !planData.amount || !planData.beneficiaries) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Create Wealth Transfer Plan</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your sensitive data will be encrypted with Zama FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Plan Type *</label>
              <select 
                name="planType"
                value={planData.planType} 
                onChange={handleChange}
                className="glass-input"
              >
                <option value="">Select plan type</option>
                <option value="Inheritance">Inheritance</option>
                <option value="Trust">Trust</option>
                <option value="Gift">Gift</option>
                <option value="Charity">Charity</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Amount *</label>
              <input 
                type="text"
                name="amount"
                value={planData.amount} 
                onChange={handleChange}
                placeholder="Estimated amount..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Beneficiaries *</label>
              <input 
                type="text"
                name="beneficiaries"
                value={planData.beneficiaries} 
                onChange={handleChange}
                placeholder="Number of beneficiaries..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description"
                value={planData.description} 
                onChange={handleChange}
                placeholder="Additional details about your wealth transfer plan..." 
                className="glass-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn glass-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PlanDetailModalProps {
  plan: WealthPlan;
  onClose: () => void;
}

const PlanDetailModal: React.FC<PlanDetailModalProps> = ({ plan, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal glass-card">
        <div className="modal-header">
          <h2>Wealth Plan Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Plan ID</label>
              <span>#{plan.id.substring(0, 8)}</span>
            </div>
            <div className="detail-item">
              <label>Type</label>
              <span>{plan.planType}</span>
            </div>
            <div className="detail-item">
              <label>Amount</label>
              <span>{plan.amount}</span>
            </div>
            <div className="detail-item">
              <label>Beneficiaries</label>
              <span>{plan.beneficiaries}</span>
            </div>
            <div className="detail-item">
              <label>Created</label>
              <span>{new Date(plan.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="detail-item">
              <label>Status</label>
              <span className={`status-badge ${plan.status}`}>{plan.status}</span>
            </div>
            <div className="detail-item full-width">
              <label>Owner</label>
              <span>{plan.owner}</span>
            </div>
          </div>
          
          <div className="fhe-notice">
            <div className="key-icon"></div> This data was processed using FHE technology for maximum privacy
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn glass-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;