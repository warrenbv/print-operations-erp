# Roles in the journey

The product was designed around real roles rather than invented personas. Each role maps to a permission role in the system. On screen a role is called a desk, and pages name the desk whose move it is, never a person.

Reading is open to every signed-in user. The rules below are about acts: who may move a quote or order to its next step.

## Sales

**Needs:** to price a request and get it to the customer without waiting on anyone, and to stay the customer's point of contact.

**May:** find, add and edit customers and their contacts, create and price quotes, set a hand-set price, request a price approval, send a quote once its conditions are met, ask for a credit-hold exception, and convert an accepted quote into an order.

**May not:** enter the lead time, approve a hand-set price, override the margin floor, change pricing configuration, or confirm an order.

## Production

**Needs:** to know what work is coming before the PO lands, and to commit only to lead times the shop can meet.

**May:** enter the lead time on a draft quote, and confirm an order with its committed lead time.

**May not:** edit a quote's lines or prices, or send a quote.

## Production Manager

**Needs:** the same as Production, plus authority over the floor's commitments.

**May:** everything Production may do in this journey. In the original system the Production Manager also cancels orders and decides cancellation requests, which the floor may only raise. The role is held by any number of users and is the one the system notifies when production needs to know something.

**May not:** edit a quote's lines or prices, or send a quote.

## Billing Manager

**Needs:** to leave the per-quote transaction, keep pricing correct and protect margin. The working documents called this the role the project changed most.

**May:** own the pricing configuration (paper grades, pricing tiers, freight and waste settings, and the margin floor itself), approve or reject a hand-set price, set and clear a customer's credit hold, and approve a single credit-hold exception.

**May not:** release a quote whose line is below the margin floor. The remedies are to re-price the line or to change the floor in configuration.

The Billing Manager sets a credit hold on the word of the person who manages receivables. The judgement is made outside the system and one role records it, so a single desk owns credit posture.

## Admin

**Needs:** users and their roles managed cleanly.

**May:** assign roles to users, and override the margin floor on one quote with a recorded reason. Admin also sits beside most desks' permissions as a fallback, but apart from assigning roles, the floor override is the one act Admin holds alone.

**May not:** create accounts or reset passwords. Authentication comes from the company directory, and the ERP only assigns roles.

## The customer

The customer is not a system user. There is no customer portal. Every electronic touchpoint is an email the platform sends, so the working documents treated those emails as part of the product.

## In this demo

The sign-in page offers four demonstration identities, one button each: **Sales**, **Production Manager**, **Billing Manager** and **Administrator**. Each holds only its own role, so the Administrator can perform the floor override and the others are refused it. The Production role is not offered, and the Production Manager covers its acts. Invoicing and receivables roles exist in the original system and are outside this edition. What each role may do in the code, and which routes are open to any signed-in user, is in [Security and access](../security-and-access.md).
