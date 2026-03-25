import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ConfirmationDetailRow = {
  label: string;
  value: string;
  isBold?: boolean;
};

interface OrderConfirmationCardProps {
  orderId?: string;
  paymentMethod?: string;
  dateTime?: string;
  totalAmount?: string;
  /** When set, replaces the default order summary rows (e.g. listing posted). */
  detailRows?: ConfirmationDetailRow[];
  onClose: () => void;
  title?: string;
  buttonText?: string;
  icon?: React.ReactNode;
  className?: string;
}

export const OrderConfirmationCard: React.FC<
  OrderConfirmationCardProps
> = ({
  orderId = "",
  paymentMethod = "",
  dateTime = "",
  totalAmount = "",
  detailRows,
  onClose,
  title = "Your order has been successfully submitted",
  buttonText = "Close",
  icon = <CheckCircle2 className="h-12 w-12 text-emerald-500" />,
  className,
}) => {
  const details: ConfirmationDetailRow[] =
    detailRows ??
    [
      { label: "Order ID", value: orderId },
      { label: "Payment method", value: paymentMethod },
      { label: "Date & time", value: dateTime },
      { label: "Total", value: totalAmount, isBold: true },
    ];

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.3,
        ease: "easeInOut",
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: "spring", stiffness: 120 },
    },
  };

  return (
    <AnimatePresence>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit={{ opacity: 0, scale: 0.96 }}
        aria-live="polite"
        className={cn(
          "w-full max-w-sm rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-xl p-6 sm:p-7",
          className
        )}
      >
        <div className="flex flex-col items-center space-y-5 text-center">
          <motion.div variants={itemVariants}>{icon}</motion.div>

          <motion.h2
            variants={itemVariants}
            className="text-xl font-semibold tracking-tight"
          >
            {title}
          </motion.h2>

          <motion.div
            variants={itemVariants}
            className="w-full space-y-3 pt-3"
          >
            {details.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className={cn(
                  "flex items-center justify-between border-b border-zinc-200 pb-3 text-xs text-zinc-500",
                  index === details.length - 1 && "border-none pb-0",
                  item.isBold && "font-semibold text-zinc-900 text-sm"
                )}
              >
                <span>{item.label}</span>
                <span className={cn(item.isBold && "text-base")}>
                  {item.value}
                </span>
              </div>
            ))}
          </motion.div>

          <motion.div variants={itemVariants} className="w-full pt-4">
            <Button
              onClick={onClose}
              className="w-full h-10 text-sm"
              size="sm"
              type="button"
            >
              {buttonText}
            </Button>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

