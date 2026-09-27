# THE ZETA HARP · MATH SPEC

*The implementable mathematics, exactly, before any surface is treated as
canonical. Distilled from THE_ZETA_HARP_DIRECTIVE.md and
THE_INVARIANT_SHEET.md of 3 August 2026 (the zeta-harp lane); every formula
below was verified by computation or against mpmath before entry.*

## The functions

    theta(t)   = (t/2) log(t/2pi) - t/2 - pi/8
                 + 1/(48t) + 7/(5760 t^3) + 31/(80640 t^5) + 127/(430080 t^7)
                 asymptotic; validated t >= 10; the instrument's navigation
                 floor is t = 100
    theta'(t)  = (1/2) log(t/2pi) - 1/(48 t^2) - 21/(5760 t^4)
                 - 155/(80640 t^6) - 889/(430080 t^8)
                 (term-by-term derivative of the same series)
    N(t)       = floor(sqrt(t/2pi))
    a_n        = 2/sqrt(n)
    phi_n(t)   = theta(t) - t log n
    c_n(t)     = a_n cos(phi_n(t))
    M(t)       = sum_{n=1..N(t)} c_n(t)
    p_n(t)     = a_n exp(i phi_n(t));   Re(sum p_n) = M(t)
    t_n        = 2pi n^2                (entry height of term n; never a
                                         frequency in any register)
    omega_n(t) = theta'(t) - log n      (rad per unit t; > 0 strictly inside
                                         the cutoff; ~ 0 at the entry height)
    f_n(t)     = omega_n(t) / 2pi
    g_n        : theta(g_n) = n pi      (Gram points; certification method
                                         cites Turing 1953, Lehman 1970,
                                         Trudgian 2011)

## The leading correction, with its guard

    p          = frac(sqrt(t/2pi))
    Psi(p)     = cos(2pi (p^2 - p - 1/16)) / cos(2pi p)
    C0(t)      = (-1)^(N(t)-1) (t/2pi)^(-1/4) Psi(p)

Psi is a removable 0/0 at p = 1/4 and p = 3/4: the numerator's zero
cancels the denominator's, the limit is finite, and a naive division
returns garbage there. The implementation MUST NOT divide near those
points. The guard, chosen for being provably second-order accurate across
a removable singularity without deriving the limit in the page: whenever
|cos(2pi p)| < 1e-4, evaluate Psi as the symmetric average
(Psi(p - h) + Psi(p + h))/2 with h = 1e-3. The pins exercise both guard
points against the reference fixtures, and the fixtures themselves are
generated at high precision where no such trick is needed.

    error(M)          = O(t^(-1/4))
    error(M + C0)     = O(t^(-3/4))

## Value classes

Every displayed number belongs to exactly one class, named on the surface:

    REFERENCE      Z_ref from the committed fixtures (mpmath, 80 digits
                   internally, hashed); R_ref = Z_ref - M
    BROWSER        theta, theta', N, a_n, phi_n, M, C0 computed in-page;
                   the main sum is the high-t browser engine (3,989 cosines
                   at t = 10^8 is trivial); the eta-series house engine
                   (luminara-zeta.js) serves only within its own stated
                   ceiling |t| <= 683
    INTERPOLATED   any value linearly interpolated between fixture samples
                   says so

## Design constants

    N(100) = 3    N(130) = 4    N(10^4) = 39    N(10^6) = 398
    N(10^8) = 3989
    the 26-term window = [4247.4332676534, 4580.4420889339)
    gamma_1 = 14.134725...  lies in (t_1, t_2) = (6.2832, 25.1327): one
    active string at the first zero; the remainder carries the rest

## Sources

DLMF 25.10 for Z and the main sum (read from the displayed mathematics,
never from a text scrape, which loses the radical in the cutoff); Turing
1953, Lehman 1970, Trudgian 2011 for certification; Platt and Trudgian
2021 (arXiv:2004.09765) for the rigorous verification height 3.0001e12
(12,363,153,437,138 zeros). The full derivation record is the invariant
sheet in the zeta-harp lane.
