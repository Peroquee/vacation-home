"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toastError, toastSuccess } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function InteractiveExamples() {
  const [crash, setCrash] = useState(false);
  // Thrown during render, so it reaches src/app/error.tsx and the error
  // tracker exactly as a real rendering bug would.
  if (crash) throw new Error("Deliberate client-side test error");

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger render={<Button variant="outline">Open modal</Button>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit booking</DialogTitle>
            <DialogDescription>A modal for short, focused forms.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Sheet>
        <SheetTrigger render={<Button variant="outline">Open sheet</Button>} />
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Booking details</SheetTitle>
            <SheetDescription>A sheet for detail views beside a list.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        trigger={<Button variant="destructive">Confirm (succeeds)</Button>}
        title="Cancel this booking?"
        description="The guest is not notified automatically."
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        destructive
        onConfirm={async () => {
          await wait(800);
          toastSuccess("Booking cancelled");
        }}
      />

      <ConfirmDialog
        trigger={<Button variant="outline">Confirm (fails)</Button>}
        title="Archive this property?"
        confirmLabel="Archive"
        onConfirm={async () => {
          await wait(800);
          throw new Error("The property still has upcoming bookings.");
        }}
      />

      <Button variant="secondary" onClick={() => toastSuccess("Booking saved")}>
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() => toastError(new Error("The server did not respond."), "Could not save")}
      >
        Error toast
      </Button>
      <Button variant="ghost" onClick={() => setCrash(true)}>
        Throw a client error
      </Button>
    </div>
  );
}
