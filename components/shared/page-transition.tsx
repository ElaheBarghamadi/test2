"use client";
import { motion, useReducedMotion } from "framer-motion";
export function PageTransition({ children }: { children: React.ReactNode }) { const reduced = useReducedMotion(); return <motion.main initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, ease: "easeOut" }} className="page-enter">{children}</motion.main>; }
