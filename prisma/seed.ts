/**
 * Demo seed for the Entra B2B Operations OS.
 *
 * Destructive: it deletes and recreates the `entra` tenant, so re-running always
 * produces the same clean dataset. Run with: npx prisma db seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  AttachmentEntity,
  ActivityAction,
  ApprovalStatus,
  DeliveryStatus,
  DocType,
  InvoiceStatus,
  InvoiceType,
  LineType,
  LostReason,
  ModuleKey,
  NotificationChannel,
  NotificationEvent,
  NotificationStatus,
  OrderStatus,
  PaymentMethod,
  PoStatus,
  ProductionStatus,
  QcResult,
  QuotationStatus,
  ReceiptStatus,
  RequestSource,
  RequestStatus,
  Role,
  SourcingStatus,
  StageStatus,
  SubcontractStatus,
  SupplierQuoteStatus,
  SupplierStatus,
  WorkOrderStatus,
  WorkflowScope,
  CustomerStatus,
} from "../src/generated/prisma/enums";
import { nextDocumentNumber } from "../src/lib/numbering";
import { summarizeDocument } from "../src/lib/pricing";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const TENANT_SLUG = "entra";
const DEMO_PASSWORD = "password123";

const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const daysFromNow = (days: number) => new Date(now.getTime() + days * 86_400_000);

type LineSpec = {
  productId?: string;
  description: string;
  quantity: number;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  discountPercent?: number;
  taxRate?: number;
  lineType?: LineType;
};

function priced(spec: LineSpec) {
  return {
    gross: spec.quantity * spec.sellingPrice,
    net: spec.quantity * spec.sellingPrice * (1 - (spec.discountPercent ?? 0) / 100),
    tax: spec.quantity * spec.sellingPrice * (1 - (spec.discountPercent ?? 0) / 100) * ((spec.taxRate ?? 11) / 100),
    cost: spec.quantity * spec.costPrice,
    lineTotal: spec.quantity * spec.sellingPrice * (1 - (spec.discountPercent ?? 0) / 100),
  };
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.$transaction(
    async (tx) => {
      // ---------------------------------------------------------------- tenant
      await tx.tenant.deleteMany({ where: { slug: TENANT_SLUG } });

      const tenant = await tx.tenant.create({
        data: {
          name: "PT Entra Nusantara",
          slug: TENANT_SLUG,
          legalName: "PT Entra Nusantara",
          address: "Jl. Industri Raya No. 42, Kawasan Industri Pulogadung",
          city: "Jakarta Timur",
          phone: "+62 21 4600 1234",
          email: "hello@entra.co.id",
          taxNumber: "01.234.567.8-901.000",
          currency: "IDR",
        },
      });
      const tenantId = tenant.id;

      await tx.tenantModule.createMany({
        data: (
          [
            ModuleKey.INVENTORY,
            ModuleKey.MULTI_WAREHOUSE,
            ModuleKey.PRODUCTION,
            ModuleKey.SUBCONTRACT,
            ModuleKey.CUSTOMER_PRICING,
            ModuleKey.APPROVAL_WORKFLOW,
            ModuleKey.WHATSAPP,
            ModuleKey.PDF_EXPORT,
          ] satisfies ModuleKey[]
        ).map((key) => ({ tenantId, key, enabled: true })),
      });

      await tx.setting.createMany({
        data: [
          { tenantId, key: "aging.requestWarningDays", value: 3 },
          { tenantId, key: "aging.quotationFollowUpDays", value: 7 },
          { tenantId, key: "aging.invoiceReminderDays", value: 3 },
          { tenantId, key: "fulfillment.delayedAfterDays", value: 14 },
          { tenantId, key: "whatsapp.senderName", value: "PT Entra Nusantara" },
        ],
      });

      await tx.documentTemplate.createMany({
        data: [
          {
            tenantId,
            docType: DocType.QUOTATION,
            name: "Standard quotation",
            footer: "Harga belum termasuk PPN kecuali disebutkan lain. Pembayaran sesuai termin terlampir.",
          },
          {
            tenantId,
            docType: DocType.INVOICE,
            name: "Standard invoice",
            footer: "Pembayaran ke rekening BCA 1234567890 a/n PT Entra Nusantara.",
          },
          {
            tenantId,
            docType: DocType.PURCHASE_ORDER,
            name: "Standard purchase order",
            footer: "Mohon cantumkan nomor PO pada setiap dokumen pengiriman.",
          },
        ],
      });

      await tx.workflowStage.createMany({
        data: ["Cutting", "Assembly", "Finishing", "QC"].map((name, index) => ({
          tenantId,
          scope: WorkflowScope.PRODUCTION,
          name,
          sortOrder: index,
        })),
      });

      await tx.approvalRule.createMany({
        data: [
          { tenantId, docType: DocType.QUOTATION, thresholdAmount: 50_000_000, approverRole: Role.MANAGER },
          { tenantId, docType: DocType.PURCHASE_ORDER, thresholdAmount: 25_000_000, approverRole: Role.MANAGER },
        ],
      });

      // ----------------------------------------------------------------- users
      const users = await Promise.all(
        [
          { name: "Andi Wijaya", email: "owner@entra.co.id", role: Role.OWNER, jobTitle: "Managing Director" },
          { name: "Rina Kusuma", email: "manager@entra.co.id", role: Role.MANAGER, jobTitle: "Operations Manager" },
          { name: "Budi Santoso", email: "sales@entra.co.id", role: Role.SALES, jobTitle: "Account Executive" },
          { name: "Sari Dewi", email: "sales2@entra.co.id", role: Role.SALES, jobTitle: "Inside Sales" },
          { name: "Hendra Putra", email: "procurement@entra.co.id", role: Role.PROCUREMENT, jobTitle: "Procurement Officer" },
          { name: "Joko Prasetyo", email: "operations@entra.co.id", role: Role.OPERATIONS, jobTitle: "Field Coordinator" },
          { name: "Maya Lestari", email: "finance@entra.co.id", role: Role.FINANCE, jobTitle: "Finance & AR" },
        ].map((user) =>
          tx.user.create({
            data: { tenantId, passwordHash, ...user },
          }),
        ),
      );
      const [owner, manager, sales, sales2, procurement, operations, finance] = users;

      // ------------------------------------------------------------ warehouses
      const [mainWarehouse, surabayaWarehouse] = await Promise.all([
        tx.warehouse.create({
          data: { tenantId, name: "Gudang Utama Jakarta", code: "GDG-JKT", address: "Pulogadung, Jakarta Timur", isDefault: true },
        }),
        tx.warehouse.create({
          data: { tenantId, name: "Gudang Surabaya", code: "GDG-SBY", address: "Rungkut, Surabaya" },
        }),
      ]);

      // -------------------------------------------------------------- products
      const productSeed = [
        { sku: "CHM-NAOH-25", name: "Sodium Hydroxide 25kg", category: "Chemical", unit: "sak", costPrice: 385_000, sellingPrice: 465_000, type: LineType.PRODUCT, tracked: true, reorder: 20 },
        { sku: "CHM-HCL-35", name: "Hydrochloric Acid 35% 30L", category: "Chemical", unit: "jerigen", costPrice: 520_000, sellingPrice: 640_000, type: LineType.PRODUCT, tracked: true, reorder: 12 },
        { sku: "CHM-COAG-50", name: "Coagulant PAC 50kg", category: "Chemical", unit: "sak", costPrice: 610_000, sellingPrice: 735_000, type: LineType.PRODUCT, tracked: true, reorder: 10 },
        { sku: "HDW-VLV-2IN", name: 'Gate Valve Cast Iron 2"', category: "Hardware", unit: "pcs", costPrice: 1_180_000, sellingPrice: 1_450_000, type: LineType.PRODUCT, tracked: true, reorder: 6 },
        { sku: "HDW-PMP-5HP", name: "Centrifugal Pump 5HP", category: "Hardware", unit: "unit", costPrice: 14_500_000, sellingPrice: 17_900_000, type: LineType.PRODUCT, tracked: true, reorder: 2 },
        { sku: "HDW-PIPE-PVC4", name: 'PVC Pipe 4" SNI (4m)', category: "Hardware", unit: "batang", costPrice: 195_000, sellingPrice: 245_000, type: LineType.PRODUCT, tracked: true, reorder: 40 },
        { sku: "SVC-INST-WTP", name: "Instalasi Water Treatment Plant", category: "Jasa", unit: "paket", costPrice: 0, sellingPrice: 0, type: LineType.SERVICE, tracked: false, reorder: 0 },
        { sku: "SVC-CALIB", name: "Kalibrasi Flow Meter", category: "Jasa", unit: "unit", costPrice: 0, sellingPrice: 0, type: LineType.SERVICE, tracked: false, reorder: 0 },
        { sku: "LBR-MECH", name: "Tenaga Mekanik (hari-orang)", category: "Labor", unit: "hari", costPrice: 0, sellingPrice: 0, type: LineType.LABOR, tracked: false, reorder: 0 },
        { sku: "PKG-WTP-STD", name: "Paket WTP Kapasitas 20 m3/jam", category: "Package", unit: "paket", costPrice: 0, sellingPrice: 0, type: LineType.PACKAGE, tracked: false, reorder: 0 },
      ];

      const products = await Promise.all(
        productSeed.map((product) =>
          tx.product.create({
            data: {
              tenantId,
              sku: product.sku,
              name: product.name,
              description: `${product.category} — ${product.name}`,
              type: product.type,
              category: product.category,
              unit: product.unit,
              costPrice: product.costPrice,
              sellingPrice: product.sellingPrice,
              isInventoryTracked: product.tracked,
              reorderPoint: product.reorder,
              createdById: procurement.id,
            },
          }),
        ),
      );
      const [naoh, hcl, pac, valve, pump, pipe, instalasi, kalibrasi, labor, paketWtp] = products;

      await tx.productUnit.createMany({
        data: [
          { tenantId, productId: naoh.id, unitName: "sak", conversionFactor: 1, isBaseUnit: true, sellingPrice: 465_000 },
          { tenantId, productId: naoh.id, unitName: "pallet", conversionFactor: 40, sellingPrice: 17_800_000 },
          { tenantId, productId: pipe.id, unitName: "batang", conversionFactor: 1, isBaseUnit: true, sellingPrice: 245_000 },
          { tenantId, productId: pipe.id, unitName: "pak", conversionFactor: 10, sellingPrice: 2_350_000 },
        ],
      });

      // -------------------------------------------------------------- suppliers
      const supplierSeed = [
        { name: "PT Kimia Jaya Abadi", category: "Chemical", leadTimeDays: 5, phone: "+62 21 5550 1111", email: "sales@kimiajaya.co.id", whatsapp: "+6281200011111" },
        { name: "CV Teknik Presisi Mandiri", category: "Hardware", leadTimeDays: 3, phone: "+62 31 8800 2222", email: "order@teknikpresisi.co.id", whatsapp: "+6281200022222" },
        { name: "PT Logam Sentosa Perkasa", category: "Hardware", leadTimeDays: 7, phone: "+62 21 5550 3333", email: "po@logamsentosa.co.id", whatsapp: "+6281200033333" },
        { name: "Jasa Kalibrasi Prima", category: "Jasa", leadTimeDays: 10, phone: "+62 22 7700 4444", email: "admin@kalibrasiprima.co.id", whatsapp: "+6281200044444" },
        { name: "PT Fabrikasi Baja Nusantara", category: "Fabrikasi", leadTimeDays: 21, phone: "+62 21 5550 5555", email: "project@bajanusantara.co.id", whatsapp: "+6281200055555" },
      ];

      const suppliers = await Promise.all(
        supplierSeed.map((supplier, index) =>
          tx.supplier.create({
            data: {
              tenantId,
              code: `SUP-${String(index + 1).padStart(3, "0")}`,
              name: supplier.name,
              category: supplier.category,
              status: SupplierStatus.ACTIVE,
              taxNumber: `02.345.678.9-0${index}1.000`,
              address: "Kawasan Industri, Indonesia",
              phone: supplier.phone,
              email: supplier.email,
              whatsappNumber: supplier.whatsapp,
              paymentTerms: index % 2 === 0 ? "30 hari" : "14 hari",
              leadTimeDays: supplier.leadTimeDays,
              rating: [4.6, 4.2, 3.9, 4.8, 3.5][index],
              createdById: procurement.id,
            },
          }),
        ),
      );
      const [kimiaJaya, teknikPresisi, logamSentosa, kalibrasiPrima, fabrikasiBaja] = suppliers;

      await tx.contact.createMany({
        data: [
          { tenantId, supplierId: kimiaJaya.id, name: "Dian Pertiwi", jobTitle: "Sales Manager", phone: "+62 21 5550 1112", email: "dian@kimiajaya.co.id", isPrimary: true },
          { tenantId, supplierId: kimiaJaya.id, name: "Agus Salim", jobTitle: "Logistics", phone: "+62 21 5550 1113", email: "agus@kimiajaya.co.id" },
          { tenantId, supplierId: teknikPresisi.id, name: "Tono Hartono", jobTitle: "Owner", phone: "+62 31 8800 2223", email: "tono@teknikpresisi.co.id", isPrimary: true },
          { tenantId, supplierId: logamSentosa.id, name: "Lina Marlina", jobTitle: "Key Account", phone: "+62 21 5550 3334", email: "lina@logamsentosa.co.id", isPrimary: true },
        ],
      });

      await tx.product.update({ where: { id: naoh.id }, data: { defaultSupplierId: kimiaJaya.id } });
      await tx.product.update({ where: { id: valve.id }, data: { defaultSupplierId: teknikPresisi.id } });
      await tx.product.update({ where: { id: pump.id }, data: { defaultSupplierId: logamSentosa.id } });

      // -------------------------------------------------------------- customers
      const customerSeed = [
        { companyName: "PT Tirta Bersih Sentosa", industry: "Water Utility", terms: "30 hari", owner: sales.id, city: "Bekasi" },
        { companyName: "PT Indofood CBP Sukses", industry: "Food & Beverage", terms: "45 hari", owner: sales.id, city: "Jakarta" },
        { companyName: "PT Pelabuhan Nusantara Jaya", industry: "Logistics", terms: "30 hari", owner: sales2.id, city: "Surabaya" },
        { companyName: "RS Mitra Sehat Utama", industry: "Healthcare", terms: "14 hari", owner: sales2.id, city: "Bandung" },
        { companyName: "CV Sinar Tekstil Mandiri", industry: "Textile", terms: "30 hari", owner: sales.id, city: "Tangerang" },
      ];

      const customers = await Promise.all(
        customerSeed.map((customer, index) =>
          tx.customer.create({
            data: {
              tenantId,
              code: `CUS-${String(index + 1).padStart(3, "0")}`,
              companyName: customer.companyName,
              industry: customer.industry,
              status: CustomerStatus.ACTIVE,
              taxNumber: `01.987.654.3-2${index}1.000`,
              address: `Jl. Raya Industri No. ${10 + index}`,
              city: customer.city,
              phone: `+62 21 7000 ${1000 + index}`,
              email: `purchasing@${customer.companyName.toLowerCase().replace(/[^a-z]+/g, "")}.co.id`,
              whatsappNumber: `+628130000${1000 + index}`,
              paymentTerms: customer.terms,
              creditLimit: 250_000_000,
              salesOwnerId: customer.owner,
              createdById: owner.id,
            },
          }),
        ),
      );
      const [tirta, indofood, pelabuhan, rumahSakit, sinarTekstil] = customers;

      await tx.contact.createMany({
        data: [
          { tenantId, customerId: tirta.id, name: "Ibu Wulandari", jobTitle: "Procurement Manager", phone: "+62 21 7000 1001", email: "wulandari@tirtabersih.co.id", whatsappNumber: "+6281300001001", isPrimary: true },
          { tenantId, customerId: tirta.id, name: "Bapak Sugianto", jobTitle: "Plant Engineer", phone: "+62 21 7000 1002", email: "sugianto@tirtabersih.co.id" },
          { tenantId, customerId: indofood.id, name: "Ibu Natalia", jobTitle: "Purchasing", phone: "+62 21 7000 2001", email: "natalia@indofood.co.id", isPrimary: true },
          { tenantId, customerId: pelabuhan.id, name: "Bapak Fahmi", jobTitle: "Technical Buyer", phone: "+62 31 7000 3001", email: "fahmi@pelabuhannusantara.co.id", isPrimary: true },
          { tenantId, customerId: rumahSakit.id, name: "Ibu Ratih", jobTitle: "Logistik", phone: "+62 22 7000 4001", email: "ratih@mitrasehat.co.id", isPrimary: true },
        ],
      });

      await tx.customerPrice.createMany({
        data: [
          { tenantId, customerId: tirta.id, productId: naoh.id, price: 425_000, minQty: 20 },
          { tenantId, customerId: indofood.id, productId: pac.id, price: 690_000, minQty: 10 },
        ],
      });

      // ------------------------------------------------------------- inventory
      await tx.stockLevel.createMany({
        data: [
          { tenantId, productId: naoh.id, warehouseId: mainWarehouse.id, onHand: 64, reserved: 20, minThreshold: 20 },
          { tenantId, productId: hcl.id, warehouseId: mainWarehouse.id, onHand: 18, reserved: 0, minThreshold: 12 },
          { tenantId, productId: pac.id, warehouseId: mainWarehouse.id, onHand: 6, reserved: 4, minThreshold: 10 },
          { tenantId, productId: valve.id, warehouseId: mainWarehouse.id, onHand: 14, reserved: 4, minThreshold: 6 },
          { tenantId, productId: pump.id, warehouseId: mainWarehouse.id, onHand: 3, reserved: 1, minThreshold: 2 },
          { tenantId, productId: pipe.id, warehouseId: mainWarehouse.id, onHand: 120, reserved: 40, minThreshold: 40 },
          { tenantId, productId: naoh.id, warehouseId: surabayaWarehouse.id, onHand: 22, reserved: 0, minThreshold: 10 },
          { tenantId, productId: pipe.id, warehouseId: surabayaWarehouse.id, onHand: 55, reserved: 0, minThreshold: 20 },
        ],
      });

      await tx.stockMovement.createMany({
        data: [
          { tenantId, productId: naoh.id, warehouseId: mainWarehouse.id, type: "IN", quantity: 64, balanceAfter: 64, referenceType: "OPENING", note: "Saldo awal", createdById: procurement.id, createdAt: daysAgo(45) },
          { tenantId, productId: pac.id, warehouseId: mainWarehouse.id, type: "IN", quantity: 12, balanceAfter: 12, referenceType: "OPENING", note: "Saldo awal", createdById: procurement.id, createdAt: daysAgo(40) },
          { tenantId, productId: pac.id, warehouseId: mainWarehouse.id, type: "OUT", quantity: 6, balanceAfter: 6, referenceType: "DELIVERY_ORDER", note: "Pengiriman ke PT Indofood", createdById: operations.id, createdAt: daysAgo(6) },
          { tenantId, productId: valve.id, warehouseId: mainWarehouse.id, type: "ADJUSTMENT", quantity: -2, balanceAfter: 14, referenceType: "ADJUSTMENT", note: "Selisih stok opname", createdById: operations.id, createdAt: daysAgo(3) },
        ],
      });

      // -------------------------------------------------------------- requests
      const requestSeed = [
        { customer: tirta, source: RequestSource.EMAIL, status: RequestStatus.QUOTATION_SENT, assigned: sales, days: 9, items: [
          { product: naoh, description: naoh.name, quantity: 30, unit: "sak", targetPrice: 450_000 },
          { product: pipe, description: pipe.name, quantity: 60, unit: "batang", targetPrice: 240_000 },
        ] },
        { customer: indofood, source: RequestSource.WHATSAPP, status: RequestStatus.PREPARING_QUOTATION, assigned: sales, days: 4, items: [
          { product: pac, description: pac.name, quantity: 25, unit: "sak", targetPrice: 700_000 },
        ] },
        { customer: pelabuhan, source: RequestSource.PHONE, status: RequestStatus.NEW, assigned: sales2, days: 1, items: [
          { product: pump, description: pump.name, quantity: 2, unit: "unit", targetPrice: 17_500_000 },
          { product: valve, description: valve.name, quantity: 6, unit: "pcs", targetPrice: 1_400_000 },
        ] },
        { customer: sinarTekstil, source: RequestSource.EMAIL, status: RequestStatus.CLOSED_LOST, assigned: sales2, days: 21, lostReason: LostReason.PRICE_TOO_HIGH, items: [
          { product: instalasi, description: "Instalasi IPAL kapasitas 10 m3/jam", quantity: 1, unit: "paket", targetPrice: 95_000_000 },
        ] },
        { customer: rumahSakit, source: RequestSource.WHATSAPP, status: RequestStatus.NEW, assigned: sales2, days: 1, items: [
          { product: kalibrasi, description: kalibrasi.name, quantity: 4, unit: "unit", targetPrice: 2_400_000 },
        ] },
      ];

      const requests = [];
      for (const seed of requestSeed) {
        const number = await nextDocumentNumber(tx, tenantId, DocType.REQUEST);
        const request = await tx.request.create({
          data: {
            tenantId,
            number,
            customerId: seed.customer.id,
            requestDate: daysAgo(seed.days),
            source: seed.source,
            status: seed.status,
            assignedToId: seed.assigned.id,
            notes: `Permintaan masuk melalui ${seed.source.toLowerCase()}.`,
            lostReason: "lostReason" in seed ? seed.lostReason : undefined,
            closedAt: seed.status === RequestStatus.CLOSED_LOST ? daysAgo(seed.days - 5) : undefined,
            createdById: seed.assigned.id,
            items: {
              create: seed.items.map((item, index) => ({
                productId: item.product.id,
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                targetPrice: item.targetPrice,
                sortOrder: index,
              })),
            },
          },
          include: { items: true },
        });
        requests.push(request);
      }
      const [requestTirta, requestIndofood, requestPelabuhan, , requestRumahSakit] = requests;

      // ------------------------------------------------------------ quotations
      type QuotationSpec = {
        request?: { id: string } | null;
        customerId: string;
        status: QuotationStatus;
        version?: number;
        supersedesId?: string;
        days: number;
        validDays: number;
        requiresApproval?: boolean;
        lines: LineSpec[];
      };

      async function createQuotation(spec: QuotationSpec) {
        const number = await nextDocumentNumber(tx, tenantId, DocType.QUOTATION);
        const summary = summarizeDocument(
          spec.lines.map((line) => ({
            quantity: line.quantity,
            unitPrice: line.sellingPrice,
            discountPercent: line.discountPercent,
            taxRate: line.taxRate ?? 11,
            costPrice: line.costPrice,
          })),
        );

        return tx.quotation.create({
          data: {
            tenantId,
            number,
            version: spec.version ?? 1,
            customerId: spec.customerId,
            requestId: spec.request?.id ?? null,
            supersedesId: spec.supersedesId,
            quotationDate: daysAgo(spec.days),
            validUntil: daysFromNow(spec.validDays),
            paymentTerms: "30 hari setelah invoice",
            deliveryTerms: "Franco Jakarta, 7 hari kerja setelah PO",
            subtotal: summary.subtotal,
            discountTotal: summary.discountTotal,
            taxTotal: summary.taxTotal,
            shippingCost: summary.shippingCost,
            grandTotal: summary.grandTotal,
            costTotal: summary.costTotal,
            estimatedProfit: summary.estimatedProfit,
            marginPercent: summary.marginPercent,
            requiresApproval: spec.requiresApproval ?? false,
            status: spec.status,
            sentAt: spec.status === QuotationStatus.DRAFT ? null : daysAgo(spec.days - 1),
            createdById: sales.id,
            items: {
              create: spec.lines.map((line, index) => {
                const p = priced(line);
                return {
                  productId: line.productId,
                  lineType: line.lineType ?? LineType.PRODUCT,
                  description: line.description,
                  quantity: line.quantity,
                  unit: line.unit,
                  costPrice: line.costPrice,
                  sellingPrice: line.sellingPrice,
                  discountPercent: line.discountPercent ?? 0,
                  taxRate: line.taxRate ?? 11,
                  lineTotal: p.lineTotal,
                  lineCost: p.cost,
                  marginPercent: p.lineTotal > 0 ? Math.round(((p.lineTotal - p.cost) / p.lineTotal) * 10000) / 100 : 0,
                  supplierId: line.productId === naoh.id ? kimiaJaya.id : line.productId === valve.id ? teknikPresisi.id : null,
                  supplierLeadTimeDays: line.productId === naoh.id ? 5 : line.productId === valve.id ? 3 : null,
                  sortOrder: index,
                };
              }),
            },
          },
          include: { items: true },
        });
      }

      const quotationTirtaV1 = await createQuotation({
        request: requestTirta,
        customerId: tirta.id,
        status: QuotationStatus.REJECTED,
        days: 8,
        validDays: 14,
        lines: [
          { productId: naoh.id, description: naoh.name, quantity: 30, unit: "sak", costPrice: 385_000, sellingPrice: 455_000 },
          { productId: pipe.id, description: pipe.name, quantity: 60, unit: "batang", costPrice: 195_000, sellingPrice: 245_000 },
        ],
      });

      const quotationTirtaV2 = await createQuotation({
        request: requestTirta,
        customerId: tirta.id,
        status: QuotationStatus.APPROVED,
        version: 2,
        supersedesId: quotationTirtaV1.id,
        days: 6,
        validDays: 21,
        lines: [
          { productId: naoh.id, description: naoh.name, quantity: 30, unit: "sak", costPrice: 385_000, sellingPrice: 440_000, discountPercent: 2 },
          { productId: pipe.id, description: pipe.name, quantity: 60, unit: "batang", costPrice: 195_000, sellingPrice: 240_000 },
        ],
      });

      const quotationIndofood = await createQuotation({
        request: requestIndofood,
        customerId: indofood.id,
        status: QuotationStatus.WAITING_APPROVAL,
        days: 3,
        validDays: 14,
        requiresApproval: true,
        lines: [
          { productId: pac.id, description: pac.name, quantity: 25, unit: "sak", costPrice: 610_000, sellingPrice: 720_000 },
          { productId: labor.id, description: "Tenaga mekanik untuk commissioning", quantity: 6, unit: "hari", costPrice: 850_000, sellingPrice: 1_150_000, lineType: LineType.LABOR },
        ],
      });

      // A walk-in quotation (no request behind it) that later becomes the second order.
      const quotationPelabuhan = await createQuotation({
        customerId: pelabuhan.id,
        status: QuotationStatus.APPROVED,
        days: 2,
        validDays: 14,
        requiresApproval: true,
        lines: [
          { productId: pump.id, description: pump.name, quantity: 2, unit: "unit", costPrice: 14_500_000, sellingPrice: 17_400_000 },
          { productId: valve.id, description: valve.name, quantity: 6, unit: "pcs", costPrice: 1_180_000, sellingPrice: 1_420_000, discountPercent: 5 },
          { productId: instalasi.id, description: "Instalasi dan commissioning pompa", quantity: 1, unit: "paket", costPrice: 6_500_000, sellingPrice: 9_500_000, lineType: LineType.SERVICE },
        ],
      });

      await tx.approval.create({
        data: {
          tenantId,
          docType: DocType.QUOTATION,
          recordId: quotationIndofood.id,
          recordNumber: quotationIndofood.number,
          amount: quotationIndofood.grandTotal,
          status: ApprovalStatus.PENDING,
          requestedById: sales.id,
          approverRole: Role.MANAGER,
        },
      });

      await tx.request.update({
        where: { id: requestTirta.id },
        data: { status: RequestStatus.CLOSED_WON, closedAt: daysAgo(5) },
      });
      await tx.request.update({ where: { id: requestIndofood.id }, data: { status: RequestStatus.QUOTATION_SENT } });
      await tx.request.update({ where: { id: requestPelabuhan.id }, data: { status: RequestStatus.QUOTATION_SENT } });
      void requestRumahSakit;

      // ----------------------------------------------------------------- orders
      async function createOrder(params: {
        quotation: { id: string; number: string; customerId: string; grandTotal: unknown; items: { productId: string | null; description: string; quantity: unknown; unit: string; sellingPrice: unknown; costPrice: unknown; discountPercent: unknown; taxRate: unknown }[] };
        status: OrderStatus;
        poNumber: string;
        poDate: Date;
        orderDate: Date;
        estimatedFulfillment: Date;
      }) {
        const number = await nextDocumentNumber(tx, tenantId, DocType.SALES_ORDER);
        const summary = summarizeDocument(
          params.quotation.items.map((item) => ({
            quantity: item.quantity as number,
            unitPrice: item.sellingPrice as number,
            discountPercent: item.discountPercent as number,
            taxRate: item.taxRate as number,
            costPrice: item.costPrice as number,
          })),
        );

        return tx.order.create({
          data: {
            tenantId,
            number,
            customerId: params.quotation.customerId,
            quotationId: params.quotation.id,
            orderDate: params.orderDate,
            customerPoNumber: params.poNumber,
            customerPoDate: params.poDate,
            estimatedFulfillmentDate: params.estimatedFulfillment,
            status: params.status,
            subtotal: summary.subtotal,
            discountTotal: summary.discountTotal,
            taxTotal: summary.taxTotal,
            shippingCost: summary.shippingCost,
            grandTotal: summary.grandTotal,
            confirmedAt: params.status === OrderStatus.DRAFT ? null : params.orderDate,
            createdById: sales.id,
            items: {
              create: params.quotation.items.map((item, index) => ({
                productId: item.productId,
                description: item.description,
                quantity: item.quantity as number,
                unit: item.unit,
                sellingPrice: item.sellingPrice as number,
                costPrice: item.costPrice as number,
                discountPercent: item.discountPercent as number,
                taxRate: item.taxRate as number,
                lineTotal: priced({
                  description: item.description,
                  quantity: item.quantity as number,
                  unit: item.unit,
                  costPrice: item.costPrice as number,
                  sellingPrice: item.sellingPrice as number,
                  discountPercent: item.discountPercent as number,
                  taxRate: item.taxRate as number,
                }).lineTotal,
                sourcingStatus: SourcingStatus.NOT_SOURCED,
                sortOrder: index,
              })),
            },
          },
          include: { items: true },
        });
      }

      const orderTirta = await createOrder({
        quotation: quotationTirtaV2,
        status: OrderStatus.IN_PROGRESS,
        poNumber: "PO/TBS/2026/0451",
        poDate: daysAgo(4),
        orderDate: daysAgo(5),
        estimatedFulfillment: daysFromNow(3),
      });

      const orderPelabuhan = await createOrder({
        quotation: quotationPelabuhan,
        status: OrderStatus.CONFIRMED,
        poNumber: "PO/PNJ/2026/1180",
        poDate: daysAgo(1),
        orderDate: daysAgo(1),
        estimatedFulfillment: daysFromNow(10),
      });

      // ------------------------------------------------------------ procurement
      const rfqNumber = await nextDocumentNumber(tx, tenantId, DocType.RFQ);
      const rfq = await tx.rfq.create({
        data: {
          tenantId,
          number: rfqNumber,
          orderId: orderTirta.id,
          rfqDate: daysAgo(4),
          dueDate: daysAgo(1),
          status: "CLOSED",
          sentAt: daysAgo(4),
          notes: "Minta penawaran terbaik termasuk ongkos kirim ke Jakarta.",
          createdById: procurement.id,
          items: {
            create: orderTirta.items.map((item) => ({
              orderItemId: item.id,
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
            })),
          },
          suppliers: {
            create: [
              { supplierId: kimiaJaya.id, status: "RESPONDED", sentAt: daysAgo(4) },
              { supplierId: teknikPresisi.id, status: "RESPONDED", sentAt: daysAgo(4) },
              { supplierId: logamSentosa.id, status: "DECLINED", sentAt: daysAgo(4), note: "Stok kosong" },
            ],
          },
        },
        include: { items: true },
      });
      const [rfqNaohItem, rfqPipeItem] = rfq.items;

      const sqKimia = await tx.supplierQuotation.create({
        data: {
          tenantId,
          rfqId: rfq.id,
          supplierId: kimiaJaya.id,
          quotedAt: daysAgo(3),
          validUntil: daysFromNow(11),
          leadTimeDays: 5,
          status: SupplierQuoteStatus.SELECTED,
          notes: "Harga sudah termasuk pengiriman ke Jakarta.",
          items: {
            create: [
              { rfqItemId: rfqNaohItem.id, productId: naoh.id, description: naoh.name, quantity: 30, unit: "sak", unitPrice: 380_000, leadTimeDays: 5, lineTotal: 30 * 380_000, isWinner: true },
              { rfqItemId: rfqPipeItem.id, productId: pipe.id, description: pipe.name, quantity: 60, unit: "batang", unitPrice: 205_000, leadTimeDays: 5, lineTotal: 60 * 205_000 },
            ],
          },
        },
        include: { items: true },
      });

      const sqPresisi = await tx.supplierQuotation.create({
        data: {
          tenantId,
          rfqId: rfq.id,
          supplierId: teknikPresisi.id,
          quotedAt: daysAgo(3),
          validUntil: daysFromNow(7),
          leadTimeDays: 3,
          status: SupplierQuoteStatus.RECEIVED,
          items: {
            create: [
              { rfqItemId: rfqNaohItem.id, productId: naoh.id, description: naoh.name, quantity: 30, unit: "sak", unitPrice: 392_000, leadTimeDays: 7, lineTotal: 30 * 392_000 },
              { rfqItemId: rfqPipeItem.id, productId: pipe.id, description: pipe.name, quantity: 60, unit: "batang", unitPrice: 189_000, leadTimeDays: 3, lineTotal: 60 * 189_000, isWinner: true },
            ],
          },
        },
        include: { items: true },
      });

      await tx.supplierQuotationItem.updateMany({
        where: { id: sqKimia.items[0].id },
        data: { isWinner: true },
      });
      await tx.supplierQuotationItem.updateMany({
        where: { id: sqPresisi.items[1].id },
        data: { isWinner: true },
      });

      // Two POs, one per winning supplier.
      const poKimiaNumber = await nextDocumentNumber(tx, tenantId, DocType.PURCHASE_ORDER);
      const poKimia = await tx.purchaseOrder.create({
        data: {
          tenantId,
          number: poKimiaNumber,
          supplierId: kimiaJaya.id,
          orderId: orderTirta.id,
          rfqId: rfq.id,
          poDate: daysAgo(3),
          expectedDate: daysFromNow(2),
          shippingTerms: "Franco gudang Jakarta",
          status: PoStatus.CONFIRMED,
          subtotal: 30 * 380_000,
          taxTotal: 30 * 380_000 * 0.11,
          grandTotal: 30 * 380_000 * 1.11,
          sentAt: daysAgo(3),
          confirmedAt: daysAgo(2),
          notes: "Kirim pagi sebelum jam 10.",
          createdById: procurement.id,
          items: {
            create: [
              {
                orderItemId: rfqNaohItem.orderItemId,
                productId: naoh.id,
                description: naoh.name,
                quantity: 30,
                unit: "sak",
                unitPrice: 380_000,
                taxRate: 11,
                lineTotal: 30 * 380_000,
              },
            ],
          },
        },
        include: { items: true },
      });

      const poPresisiNumber = await nextDocumentNumber(tx, tenantId, DocType.PURCHASE_ORDER);
      const poPresisi = await tx.purchaseOrder.create({
        data: {
          tenantId,
          number: poPresisiNumber,
          supplierId: teknikPresisi.id,
          orderId: orderTirta.id,
          rfqId: rfq.id,
          poDate: daysAgo(3),
          expectedDate: daysAgo(1),
          shippingTerms: "Ambil di gudang supplier",
          status: PoStatus.PARTIAL_RECEIVED,
          subtotal: 60 * 189_000,
          taxTotal: 60 * 189_000 * 0.11,
          grandTotal: 60 * 189_000 * 1.11,
          sentAt: daysAgo(3),
          confirmedAt: daysAgo(3),
          createdById: procurement.id,
          items: {
            create: [
              {
                orderItemId: rfqPipeItem.orderItemId,
                productId: pipe.id,
                description: pipe.name,
                quantity: 60,
                unit: "batang",
                unitPrice: 189_000,
                taxRate: 11,
                lineTotal: 60 * 189_000,
              },
            ],
          },
        },
        include: { items: true },
      });

      // A third PO waiting on internal approval before it can be sent.
      const poPendingNumber = await nextDocumentNumber(tx, tenantId, DocType.PURCHASE_ORDER);
      const poPending = await tx.purchaseOrder.create({
        data: {
          tenantId,
          number: poPendingNumber,
          supplierId: logamSentosa.id,
          orderId: orderPelabuhan.id,
          poDate: now,
          expectedDate: daysFromNow(9),
          shippingTerms: "Franco Surabaya",
          status: PoStatus.PENDING_APPROVAL,
          requiresApproval: true,
          subtotal: 2 * 14_200_000,
          taxTotal: 2 * 14_200_000 * 0.11,
          grandTotal: 2 * 14_200_000 * 1.11,
          notes: "Menunggu approval Manager karena di atas threshold.",
          createdById: procurement.id,
          items: {
            create: [
              {
                orderItemId: orderPelabuhan.items[0].id,
                productId: pump.id,
                description: pump.name,
                quantity: 2,
                unit: "unit",
                unitPrice: 14_200_000,
                taxRate: 11,
                lineTotal: 2 * 14_200_000,
              },
            ],
          },
        },
        include: { items: true },
      });

      await tx.approval.create({
        data: {
          tenantId,
          docType: DocType.PURCHASE_ORDER,
          recordId: poPending.id,
          recordNumber: poPending.number,
          amount: poPending.grandTotal,
          status: ApprovalStatus.PENDING,
          requestedById: procurement.id,
          approverRole: Role.MANAGER,
        },
      });

      // Receiving: the pipe PO arrives in two shipments, the first one already booked in.
      const grnNumber = await nextDocumentNumber(tx, tenantId, DocType.GOODS_RECEIPT);
      await tx.goodsReceipt.create({
        data: {
          tenantId,
          number: grnNumber,
          purchaseOrderId: poPresisi.id,
          receivedDate: daysAgo(1),
          status: ReceiptStatus.PARTIAL,
          warehouseId: mainWarehouse.id,
          notes: "Pengiriman tahap 1 dari 2.",
          createdById: operations.id,
          items: {
            create: [
              {
                purchaseOrderItemId: poPresisi.items[0].id,
                productId: pipe.id,
                quantityReceived: 40,
                quantityRejected: 0,
              },
            ],
          },
        },
      });

      await tx.purchaseOrderItem.update({
        where: { id: poPresisi.items[0].id },
        data: { receivedQty: 40 },
      });
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: pipe.id,
          warehouseId: mainWarehouse.id,
          type: "IN",
          quantity: 40,
          balanceAfter: 160,
          referenceType: "GOODS_RECEIPT",
          referenceId: grnNumber,
          note: `Penerimaan sebagian ${poPresisi.number}`,
          createdById: operations.id,
          createdAt: daysAgo(1),
        },
      });
      await tx.stockLevel.update({
        where: { productId_warehouseId: { productId: pipe.id, warehouseId: mainWarehouse.id } },
        data: { onHand: 160 },
      });
      await tx.orderItem.update({
        where: { id: rfqPipeItem.orderItemId! },
        data: { sourcingStatus: SourcingStatus.SOURCING },
      });
      await tx.orderItem.update({
        where: { id: rfqNaohItem.orderItemId! },
        data: { sourcingStatus: SourcingStatus.SOURCED },
      });

      // ------------------------------------------------------------ fulfillment
      const woNumber = await nextDocumentNumber(tx, tenantId, DocType.WORK_ORDER);
      await tx.workOrder.create({
        data: {
          tenantId,
          number: woNumber,
          orderId: orderPelabuhan.id,
          title: "Instalasi dan commissioning pompa sentrifugal",
          description: "Pemasangan 2 unit pompa, alignment, dan uji debit di lokasi pelanggan.",
          assigneeId: operations.id,
          teamName: "Tim Lapangan B",
          scheduledStart: daysFromNow(1),
          scheduledEnd: daysFromNow(5),
          progressPercent: 25,
          status: WorkOrderStatus.IN_PROGRESS,
          startedAt: daysAgo(1),
          createdById: manager.id,
          tasks: {
            create: [
              { name: "Mobilisasi alat dan tim", sortOrder: 0, isCompleted: true, completedAt: daysAgo(1) },
              { name: "Pemasangan dudukan pompa", sortOrder: 1, isCompleted: true, completedAt: daysAgo(1) },
              { name: "Piping dan alignment", sortOrder: 2, isCompleted: false },
              { name: "Uji debit dan serah terima", sortOrder: 3, isCompleted: false },
            ],
          },
          logs: {
            create: [
              { logDate: daysAgo(1), note: "Tim tiba di lokasi, area kerja disiapkan.", hoursSpent: 9, createdById: operations.id },
              { logDate: now, note: "Dudukan pompa selesai dipasang, lanjut piping besok.", hoursSpent: 7, createdById: operations.id },
            ],
          },
        },
      });

      const productionNumber = await nextDocumentNumber(tx, tenantId, DocType.PRODUCTION_ORDER);
      await tx.productionOrder.create({
        data: {
          tenantId,
          number: productionNumber,
          orderId: orderTirta.id,
          productId: paketWtp.id,
          description: "Fabrikasi skid WTP kapasitas 20 m3/jam",
          quantity: 1,
          unit: "paket",
          status: ProductionStatus.IN_PROGRESS,
          currentStage: "Assembly",
          scheduledStart: daysAgo(2),
          scheduledEnd: daysFromNow(6),
          startedAt: daysAgo(2),
          createdById: operations.id,
          stages: {
            create: [
              { name: "Cutting", sortOrder: 0, status: StageStatus.DONE, startedAt: daysAgo(2), completedAt: daysAgo(1) },
              { name: "Assembly", sortOrder: 1, status: StageStatus.IN_PROGRESS, startedAt: daysAgo(1) },
              { name: "Finishing", sortOrder: 2, status: StageStatus.PENDING },
              { name: "QC", sortOrder: 3, status: StageStatus.PENDING },
            ],
          },
          qcRecords: {
            create: [
              { inspectedAt: daysAgo(1), result: QcResult.PASS, note: "Dimensi rangka sesuai drawing.", inspectedById: manager.id },
            ],
          },
        },
      });

      const subcontractNumber = await nextDocumentNumber(tx, tenantId, DocType.SUBCONTRACT);
      await tx.subcontract.create({
        data: {
          tenantId,
          number: subcontractNumber,
          orderId: orderTirta.id,
          supplierId: fabrikasiBaja.id,
          scope: "Fabrikasi tangki penampung 5000L",
          description: "Plate 6mm, coating epoxy food grade dua lapis.",
          value: 42_000_000,
          progressPercent: 60,
          status: SubcontractStatus.INSPECTION,
          scheduledStart: daysAgo(6),
          scheduledEnd: daysFromNow(4),
          createdById: procurement.id,
        },
      });

      // --------------------------------------------------------------- delivery
      const doNumber = await nextDocumentNumber(tx, tenantId, DocType.DELIVERY_ORDER);
      await tx.deliveryOrder.create({
        data: {
          tenantId,
          number: doNumber,
          orderId: orderTirta.id,
          customerId: tirta.id,
          status: DeliveryStatus.DELIVERED,
          shipMethod: "Truk sendiri",
          driverName: "Pak Slamet",
          vehicleNumber: "B 9123 KJU",
          deliveryAddress: "Jl. Raya Industri No. 10, Bekasi",
          shipDate: daysAgo(2),
          deliveredDate: daysAgo(2),
          receiverName: "Bapak Sugianto",
          proofNote: "Barang diterima lengkap, tanda tangan di surat jalan.",
          createdById: operations.id,
          items: {
            create: [
              {
                orderItemId: orderTirta.items[0].id,
                quantity: 30,
                unit: "sak",
              },
            ],
          },
        },
      });

      await tx.orderItem.update({ where: { id: orderTirta.items[0].id }, data: { deliveredQty: 30, fulfilledQty: 30 } });

      const doNumber2 = await nextDocumentNumber(tx, tenantId, DocType.DELIVERY_ORDER);
      await tx.deliveryOrder.create({
        data: {
          tenantId,
          number: doNumber2,
          orderId: orderPelabuhan.id,
          customerId: pelabuhan.id,
          status: DeliveryStatus.READY_TO_SHIP,
          shipMethod: "Ekspedisi",
          courierName: "Indah Cargo",
          trackingNumber: "IC-88231940",
          deliveryAddress: "Jl. Raya Industri No. 12, Surabaya",
          createdById: operations.id,
          items: {
            create: [
              { orderItemId: orderPelabuhan.items[0].id, quantity: 2, unit: "unit" },
            ],
          },
        },
      });

      // ---------------------------------------------------------------- finance
      const invNumber = await nextDocumentNumber(tx, tenantId, DocType.INVOICE);
      const invoicePaid = await tx.invoice.create({
        data: {
          tenantId,
          number: invNumber,
          customerId: tirta.id,
          orderId: orderTirta.id,
          type: InvoiceType.PARTIAL,
          status: InvoiceStatus.PAID,
          invoiceDate: daysAgo(2),
          dueDate: daysFromNow(13),
          paymentTerms: "30 hari",
          subtotal: 30 * 440_000 * 0.98,
          taxTotal: 30 * 440_000 * 0.98 * 0.11,
          grandTotal: 30 * 440_000 * 0.98 * 1.11,
          amountPaid: 30 * 440_000 * 0.98 * 1.11,
          sentAt: daysAgo(2),
          paidAt: daysAgo(1),
          createdById: finance.id,
          items: {
            create: [
              {
                orderItemId: orderTirta.items[0].id,
                description: orderTirta.items[0].description,
                quantity: 30,
                unit: "sak",
                unitPrice: 440_000,
                discountPercent: 2,
                taxRate: 11,
                lineTotal: 30 * 440_000 * 0.98,
                sortOrder: 0,
              },
            ],
          },
        },
      });

      const paymentNumber = await nextDocumentNumber(tx, tenantId, DocType.PAYMENT);
      await tx.payment.create({
        data: {
          tenantId,
          number: paymentNumber,
          invoiceId: invoicePaid.id,
          customerId: tirta.id,
          paymentDate: daysAgo(1),
          amount: 30 * 440_000 * 0.98 * 1.11,
          method: PaymentMethod.TRANSFER,
          referenceNumber: "TRF-BCA-88213",
          notes: "Pembayaran via transfer BCA.",
          createdById: finance.id,
        },
      });

      const invNumber2 = await nextDocumentNumber(tx, tenantId, DocType.INVOICE);
      const invoiceOverdue = await tx.invoice.create({
        data: {
          tenantId,
          number: invNumber2,
          customerId: indofood.id,
          type: InvoiceType.PROGRESS,
          status: InvoiceStatus.OVERDUE,
          invoiceDate: daysAgo(50),
          dueDate: daysAgo(20),
          paymentTerms: "30 hari",
          subtotal: 10 * 720_000,
          taxTotal: 10 * 720_000 * 0.11,
          grandTotal: 10 * 720_000 * 1.11,
          amountPaid: 3_000_000,
          sentAt: daysAgo(50),
          createdById: finance.id,
          items: {
            create: [
              { description: "Termin 1 — PAC 50kg", quantity: 10, unit: "sak", unitPrice: 720_000, taxRate: 11, lineTotal: 10 * 720_000, sortOrder: 0 },
            ],
          },
        },
      });

      const paymentNumber2 = await nextDocumentNumber(tx, tenantId, DocType.PAYMENT);
      await tx.payment.create({
        data: {
          tenantId,
          number: paymentNumber2,
          invoiceId: invoiceOverdue.id,
          customerId: indofood.id,
          paymentDate: daysAgo(35),
          amount: 3_000_000,
          method: PaymentMethod.TRANSFER,
          referenceNumber: "TRF-MANDIRI-11230",
          notes: "Pembayaran sebagian.",
          createdById: finance.id,
        },
      });

      const invNumber3 = await nextDocumentNumber(tx, tenantId, DocType.INVOICE);
      await tx.invoice.create({
        data: {
          tenantId,
          number: invNumber3,
          customerId: pelabuhan.id,
          orderId: orderPelabuhan.id,
          type: InvoiceType.MILESTONE,
          status: InvoiceStatus.DRAFT,
          invoiceDate: now,
          dueDate: daysFromNow(30),
          paymentTerms: "30 hari",
          subtotal: orderPelabuhan.grandTotal as unknown as number,
          taxTotal: 0,
          grandTotal: orderPelabuhan.grandTotal as unknown as number,
          createdById: finance.id,
          items: {
            create: orderPelabuhan.items.map((item, index) => ({
              orderItemId: item.id,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.sellingPrice,
              discountPercent: item.discountPercent,
              taxRate: 0,
              lineTotal: item.lineTotal,
              sortOrder: index,
            })),
          },
        },
      });

      // ------------------------------------------------------------ attachments
      await tx.attachment.createMany({
        data: [
          { tenantId, entityType: AttachmentEntity.CUSTOMER, entityId: tirta.id, fileName: "kontrak-tirta-2026.pdf", mimeType: "application/pdf", sizeBytes: 284_112, url: "/storage/demo/kontrak-tirta-2026.pdf", label: "Master service agreement", uploadedById: sales.id },
          { tenantId, entityType: AttachmentEntity.REQUEST, entityId: requestTirta.id, fileName: "email-permintaan-tirta.eml", mimeType: "message/rfc822", sizeBytes: 45_120, url: "/storage/demo/email-permintaan-tirta.eml", label: "Email asli dari customer", uploadedById: sales.id },
          { tenantId, entityType: AttachmentEntity.ORDER, entityId: orderTirta.id, fileName: "PO-TBS-0451.pdf", mimeType: "application/pdf", sizeBytes: 128_400, url: "/storage/demo/PO-TBS-0451.pdf", label: "PO customer", uploadedById: sales.id },
          { tenantId, entityType: AttachmentEntity.PURCHASE_ORDER, entityId: poKimia.id, fileName: "PO-KimiaJaya-signed.pdf", mimeType: "application/pdf", sizeBytes: 96_300, url: "/storage/demo/PO-KimiaJaya-signed.pdf", label: "PO tertanda tangan", uploadedById: procurement.id },
          { tenantId, entityType: AttachmentEntity.DELIVERY_ORDER, entityId: doNumber, fileName: "bukti-terima-tirta.jpg", mimeType: "image/jpeg", sizeBytes: 512_000, url: "/storage/demo/bukti-terima-tirta.jpg", label: "Proof of delivery", uploadedById: operations.id },
        ],
      });

      // --------------------------------------------------------------- comments
      await tx.comment.createMany({
        data: [
          { tenantId, entityType: AttachmentEntity.CUSTOMER, entityId: tirta.id, body: "Customer minta pembayaran 30 hari; sudah disetujui Finance.", authorId: sales.id, authorName: sales.name, createdAt: daysAgo(10) },
          { tenantId, entityType: AttachmentEntity.QUOTATION, entityId: quotationPelabuhan.id, body: "Margin tipis di pompa — jangan kasih diskon tambahan.", authorId: sales2.id, authorName: sales2.name, createdAt: daysAgo(2) },
          { tenantId, entityType: AttachmentEntity.ORDER, entityId: orderTirta.id, body: "Pipa baru datang 40 batang, sisa 20 menyusul minggu depan.", authorId: operations.id, authorName: operations.name, createdAt: daysAgo(1) },
        ],
      });

      // ---------------------------------------------------------- notifications
      await tx.notification.createMany({
        data: [
          { tenantId, event: NotificationEvent.QUOTATION_APPROVAL_REQUESTED, channel: NotificationChannel.IN_APP, status: NotificationStatus.PENDING, recipient: manager.email, recipientName: manager.name, subject: `Quotation ${quotationIndofood.number} needs approval`, body: `Quotation ${quotationIndofood.number} for PT Indofood CBP Sukses is above the approval threshold.`, entityType: AttachmentEntity.QUOTATION, entityId: quotationIndofood.id, entityLabel: quotationIndofood.number, createdAt: daysAgo(3) },
          { tenantId, event: NotificationEvent.INVOICE_OVERDUE, channel: NotificationChannel.WHATSAPP, status: NotificationStatus.SENT, recipient: "+6281300001002", recipientName: "Ibu Natalia", subject: "Invoice overdue", body: `Invoice ${invoiceOverdue.number} sudah melewati jatuh tempo 20 hari. Mohon konfirmasi pembayaran.`, entityType: AttachmentEntity.INVOICE, entityId: invoiceOverdue.id, entityLabel: invoiceOverdue.number, sentAt: daysAgo(18), attempts: 1, createdAt: daysAgo(18) },
          { tenantId, event: NotificationEvent.PO_SUPPLIER_LATE, channel: NotificationChannel.WHATSAPP, status: NotificationStatus.PENDING, recipient: "+6281200022222", recipientName: "Tono Hartono", subject: "PO melewati expected date", body: `PO ${poPresisi.number} belum diterima penuh, expected date ${daysAgo(1).toLocaleDateString("id-ID")}.`, entityType: AttachmentEntity.PURCHASE_ORDER, entityId: poPresisi.id, entityLabel: poPresisi.number, createdAt: daysAgo(1) },
          { tenantId, event: NotificationEvent.DELIVERY_COMPLETED, channel: NotificationChannel.WHATSAPP, status: NotificationStatus.SENT, recipient: "+6281300001001", recipientName: "Ibu Wulandari", subject: "Pengiriman selesai", body: `Surat jalan ${doNumber} sudah diterima. Terima kasih.`, entityType: AttachmentEntity.DELIVERY_ORDER, entityId: doNumber, entityLabel: doNumber, sentAt: daysAgo(2), attempts: 1, createdAt: daysAgo(2) },
          { tenantId, event: NotificationEvent.REQUEST_AGING, channel: NotificationChannel.IN_APP, status: NotificationStatus.PENDING, recipient: sales2.email, recipientName: sales2.name, subject: "Request belum ditindaklanjuti", body: `Request ${requestPelabuhan.number} sudah 1 hari tanpa tindak lanjut.`, entityType: AttachmentEntity.REQUEST, entityId: requestPelabuhan.id, entityLabel: requestPelabuhan.number, createdAt: now },
        ],
      });

      // ------------------------------------------------------------ activity log
      const activity: {
        action: ActivityAction;
        entityType: AttachmentEntity;
        entityId: string;
        entityLabel: string;
        summary: string;
        userId: string;
        userName: string;
        days: number;
      }[] = [
        { action: ActivityAction.CREATE, entityType: AttachmentEntity.CUSTOMER, entityId: tirta.id, entityLabel: tirta.companyName, summary: "Customer created", userId: sales.id, userName: sales.name, days: 30 },
        { action: ActivityAction.CREATE, entityType: AttachmentEntity.REQUEST, entityId: requestTirta.id, entityLabel: requestTirta.number, summary: "Request logged from email", userId: sales.id, userName: sales.name, days: 9 },
        { action: ActivityAction.CONVERT, entityType: AttachmentEntity.QUOTATION, entityId: quotationTirtaV2.id, entityLabel: quotationTirtaV2.number, summary: "Quotation revision v2 created from v1", userId: sales.id, userName: sales.name, days: 6 },
        { action: ActivityAction.APPROVE, entityType: AttachmentEntity.QUOTATION, entityId: quotationTirtaV2.id, entityLabel: quotationTirtaV2.number, summary: "Quotation approved by Manager", userId: manager.id, userName: manager.name, days: 5 },
        { action: ActivityAction.CONVERT, entityType: AttachmentEntity.ORDER, entityId: orderTirta.id, entityLabel: orderTirta.number, summary: "Order created from approved quotation", userId: sales.id, userName: sales.name, days: 5 },
        { action: ActivityAction.CREATE, entityType: AttachmentEntity.RFQ, entityId: rfq.id, entityLabel: rfq.number, summary: "RFQ sent to 3 suppliers", userId: procurement.id, userName: procurement.name, days: 4 },
        { action: ActivityAction.CREATE, entityType: AttachmentEntity.PURCHASE_ORDER, entityId: poKimia.id, entityLabel: poKimia.number, summary: "Purchase order generated for PT Kimia Jaya Abadi", userId: procurement.id, userName: procurement.name, days: 3 },
        { action: ActivityAction.STATUS_CHANGE, entityType: AttachmentEntity.PURCHASE_ORDER, entityId: poPresisi.id, entityLabel: poPresisi.number, summary: "Status changed to Partially Received", userId: operations.id, userName: operations.name, days: 1 },
        { action: ActivityAction.SEND, entityType: AttachmentEntity.INVOICE, entityId: invoiceOverdue.id, entityLabel: invoiceOverdue.number, summary: "Overdue reminder sent via WhatsApp", userId: finance.id, userName: finance.name, days: 18 },
        { action: ActivityAction.STATUS_CHANGE, entityType: AttachmentEntity.DELIVERY_ORDER, entityId: doNumber, entityLabel: doNumber, summary: "Delivery confirmed as delivered", userId: operations.id, userName: operations.name, days: 2 },
      ];

      await tx.activityLog.createMany({
        data: activity.map((entry) => ({
          tenantId,
          userId: entry.userId,
          userName: entry.userName,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          entityLabel: entry.entityLabel,
          summary: entry.summary,
          createdAt: daysAgo(entry.days),
        })),
      });

      console.log(`Seeded tenant "${tenant.name}" (${tenant.slug})`);
      console.log(`  users: ${users.length} • customers: ${customers.length} • suppliers: ${suppliers.length} • products: ${products.length}`);
      console.log(`  requests: ${requests.length} • quotations: 4 • orders: 2 • POs: 3 • invoices: 3`);
      console.log(`  sign in with owner@entra.co.id / ${DEMO_PASSWORD}`);
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
