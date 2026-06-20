import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Check } from "lucide-react";

export default function Pricing() {
  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-16">
      <div className="text-center space-y-4">
        <h1 className="text-4xl md:text-5xl font-black text-white">Simple, transparent pricing</h1>
        <p className="text-muted-foreground text-xl max-w-2xl mx-auto">Choose the plan that fits your creative needs. Upgrade or downgrade at any time.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Starter */}
        <Card className="bg-card border-border flex flex-col">
          <CardHeader>
            <CardTitle className="text-2xl">Starter</CardTitle>
            <CardDescription className="text-muted-foreground">For independent artists just starting out.</CardDescription>
            <div className="mt-4 flex items-baseline text-4xl font-bold">
              $0<span className="text-lg text-muted-foreground font-normal ml-1">/month</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-3">
              {["50 credits/month", "Make a Song", "Make a Music Video", "Watermarked outputs"].map((feature, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-primary" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">Get Started Free</Button>
          </CardFooter>
        </Card>

        {/* Creator */}
        <Card className="bg-card border-primary relative flex flex-col transform md:-translate-y-4 shadow-[0_0_30px_rgba(147,51,234,0.15)]">
          <div className="absolute top-0 inset-x-0 -translate-y-1/2 flex justify-center">
            <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
              Most Popular
            </span>
          </div>
          <CardHeader>
            <CardTitle className="text-2xl">Creator</CardTitle>
            <CardDescription className="text-muted-foreground">For active creators dropping consistently.</CardDescription>
            <div className="mt-4 flex items-baseline text-4xl font-bold">
              $19<span className="text-lg text-muted-foreground font-normal ml-1">/month</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-3">
              {["300 credits/month", "All tools", "No watermarks", "Priority generation", "Download all outputs"].map((feature, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-primary" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button className="w-full purple-glow">Start Creating</Button>
          </CardFooter>
        </Card>

        {/* Pro Studio */}
        <Card className="bg-card border-border flex flex-col">
          <CardHeader>
            <CardTitle className="text-2xl">Pro Studio</CardTitle>
            <CardDescription className="text-muted-foreground">For labels, managers, and power users.</CardDescription>
            <div className="mt-4 flex items-baseline text-4xl font-bold">
              $49<span className="text-lg text-muted-foreground font-normal ml-1">/month</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-3">
              {["Unlimited credits", "All Creator features", "Custom brand kit", "Team seats (3)", "API access", "Dedicated support"].map((feature, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-primary" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">Go Pro</Button>
          </CardFooter>
        </Card>
      </div>

      <div className="max-w-3xl mx-auto pt-16">
        <h2 className="text-3xl font-bold text-center mb-8">Frequently Asked Questions</h2>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger className="text-lg">What are credits?</AccordionTrigger>
            <AccordionContent className="text-muted-foreground text-base">
              Credits are the currency used to generate AI content on Bow Down Visuals. Generating a song costs 5 credits, while a full video treatment costs 10 credits. Your credits refresh every month depending on your plan.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger className="text-lg">Can I cancel anytime?</AccordionTrigger>
            <AccordionContent className="text-muted-foreground text-base">
              Yes. You can upgrade, downgrade, or cancel your subscription at any time from your account settings. There are no long-term contracts.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger className="text-lg">What file formats do I get?</AccordionTrigger>
            <AccordionContent className="text-muted-foreground text-base">
              Text outputs (lyrics, treatments, captions) can be copied directly or downloaded as PDF/TXT files. Generated images and thumbnails are provided as high-resolution PNGs.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-4">
            <AccordionTrigger className="text-lg">Is my content private?</AccordionTrigger>
            <AccordionContent className="text-muted-foreground text-base">
              Absolutely. We do not use your generated content, lyrics, or personal details to train our models. Your projects belong to you.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-5">
            <AccordionTrigger className="text-lg">Do you offer refunds?</AccordionTrigger>
            <AccordionContent className="text-muted-foreground text-base">
              We offer a 7-day money-back guarantee if you are not satisfied with your first month. Please reach out to our support team.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
