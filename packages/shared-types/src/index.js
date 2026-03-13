"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CylinderEventType = exports.SaleType = exports.PaymentMethod = exports.OutboxStatus = exports.LocationType = void 0;
var LocationType;
(function (LocationType) {
    LocationType["BRANCH_STORE"] = "BRANCH_STORE";
    LocationType["BRANCH_WAREHOUSE"] = "BRANCH_WAREHOUSE";
    LocationType["TRUCK"] = "TRUCK";
    LocationType["PERSONNEL"] = "PERSONNEL";
})(LocationType || (exports.LocationType = LocationType = {}));
var OutboxStatus;
(function (OutboxStatus) {
    OutboxStatus["PENDING"] = "pending";
    OutboxStatus["PROCESSING"] = "processing";
    OutboxStatus["SYNCED"] = "synced";
    OutboxStatus["FAILED"] = "failed";
    OutboxStatus["NEEDS_REVIEW"] = "needs_review";
})(OutboxStatus || (exports.OutboxStatus = OutboxStatus = {}));
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["CASH"] = "CASH";
    PaymentMethod["CARD"] = "CARD";
    PaymentMethod["E_WALLET"] = "E_WALLET";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
var SaleType;
(function (SaleType) {
    SaleType["PICKUP"] = "PICKUP";
    SaleType["DELIVERY"] = "DELIVERY";
})(SaleType || (exports.SaleType = SaleType = {}));
var CylinderEventType;
(function (CylinderEventType) {
    CylinderEventType["ISSUE"] = "ISSUE";
    CylinderEventType["RETURN"] = "RETURN";
    CylinderEventType["EXCHANGE"] = "EXCHANGE";
    CylinderEventType["TRANSFER"] = "TRANSFER";
    CylinderEventType["REFILL"] = "REFILL";
    CylinderEventType["DAMAGE"] = "DAMAGE";
    CylinderEventType["LOSS"] = "LOSS";
})(CylinderEventType || (exports.CylinderEventType = CylinderEventType = {}));
//# sourceMappingURL=index.js.map